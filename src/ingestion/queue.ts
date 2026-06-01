import { EventEmitter } from 'events';
import PQueue from 'p-queue';

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
  private queue: PQueue;
  private state: 'RUNNING' | 'PAUSED' = 'RUNNING';

  constructor(maxConcurrentWorkers: number = 4) {
    super();
    this.queue = new PQueue({ concurrency: maxConcurrentWorkers });
  }

  public addJob(job: Omit<Job, 'status' | 'retryCount'>) {
    if (!this.jobs.has(job.id)) {
      const fullJob: Job = {
        ...job,
        status: 'pending',
        retryCount: 0
      };
      this.jobs.set(job.id, fullJob);
      this.emit('job_added');
      this.enqueueToPQueue(fullJob);
    }
  }

  private enqueueToPQueue(job: Job) {
    this.queue.add(async () => {
      // Check if paused. PQueue naturally pauses if we call queue.pause(), 
      // but double check status here just in case.
      job.status = 'processing';
      
      return new Promise<void>((resolve) => {
        this.emit('process_job', job, (err?: Error) => {
          if (err) {
            job.status = 'failed';
            job.error = err.message;
            job.retryCount++;
            console.warn(`[JobQueue] Job failed: ${job.title} - ${err.message}`);
          } else {
            job.status = 'completed';
          }
          resolve();
        });
      });
    });
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

  public getFailedJobs(): Job[] {
    const failed: Job[] = [];
    for (const job of this.jobs.values()) {
      if (job.status === 'failed') {
        failed.push(job);
      }
    }
    return failed;
  }

  public pause() {
    this.state = 'PAUSED';
    this.queue.pause();
    console.log("[JobQueue] Paused.");
  }

  public resume() {
    this.state = 'RUNNING';
    this.queue.start();
    console.log("[JobQueue] Resumed.");
  }

  public getState() {
    return this.state;
  }

  /**
   * Resets all failed jobs back to pending and re-adds them to p-queue.
   */
  public retryFailed() {
    let retried = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'failed') {
        job.status = 'pending';
        job.error = undefined;
        this.enqueueToPQueue(job);
        retried++;
      }
    }
    console.log(`[JobQueue] Retrying ${retried} failed jobs.`);
  }
}
