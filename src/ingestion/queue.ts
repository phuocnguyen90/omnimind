import { EventEmitter } from 'events';

export type JobStatus = 'pending' | 'processing' | 'failed' | 'completed';

export interface Job {
  id: string; // unique identifier (e.g. cite_key or file path)
  type: 'zotero' | 'obsidian';
  title: string;
  status: JobStatus;
  payload: any; // Context for the job (e.g. sqlite row or obsidian note object)
  error?: string;
  retryCount: number;
}

export interface JobQueueStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export class JobQueue extends EventEmitter {
  private jobs: Map<string, Job> = new Map();
  private maxConcurrentWorkers: number;
  private activeWorkers: number = 0;
  private state: 'RUNNING' | 'PAUSED' = 'RUNNING';

  constructor(maxConcurrentWorkers: number = 4) {
    super();
    this.maxConcurrentWorkers = maxConcurrentWorkers;
  }

  public addJob(job: Omit<Job, 'status' | 'retryCount'>) {
    if (!this.jobs.has(job.id)) {
      this.jobs.set(job.id, {
        ...job,
        status: 'pending',
        retryCount: 0
      });
      this.emit('job_added');
      this.pump();
    }
  }

  public getStats(): JobQueueStats {
    let pending = 0, processing = 0, completed = 0, failed = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'pending') pending++;
      else if (job.status === 'processing') processing++;
      else if (job.status === 'completed') completed++;
      else if (job.status === 'failed') failed++;
    }
    return { total: this.jobs.size, pending, processing, completed, failed };
  }

  public pause() {
    this.state = 'PAUSED';
    console.log("[JobQueue] Paused.");
  }

  public resume() {
    this.state = 'RUNNING';
    console.log("[JobQueue] Resumed.");
    this.pump();
  }

  public getState() {
    return this.state;
  }

  /**
   * Resets all failed jobs back to pending.
   */
  public retryFailed() {
    let retried = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'failed') {
        job.status = 'pending';
        job.error = undefined;
        retried++;
      }
    }
    console.log(`[JobQueue] Retrying ${retried} failed jobs.`);
    if (retried > 0) this.pump();
  }

  /**
   * The core pump loop that pulls pending jobs and processes them
   */
  private async pump() {
    if (this.state === 'PAUSED') return;
    
    while (this.activeWorkers < this.maxConcurrentWorkers) {
      const nextJob = this.getNextPendingJob();
      if (!nextJob) break; // Queue empty or no pending jobs

      this.activeWorkers++;
      nextJob.status = 'processing';
      
      this.emit('process_job', nextJob, async (err?: Error) => {
        if (err) {
          nextJob.status = 'failed';
          nextJob.error = err.message;
          nextJob.retryCount++;
          console.warn(`[JobQueue] Job failed: ${nextJob.title} - ${err.message}`);
        } else {
          nextJob.status = 'completed';
        }
        
        this.activeWorkers--;
        // Immediately try to pump another job
        this.pump();
      });
    }
  }

  private getNextPendingJob(): Job | undefined {
    for (const job of this.jobs.values()) {
      if (job.status === 'pending') {
        return job;
      }
    }
    return undefined;
  }
}
