export type WorkerGroupType = 'Analysis' | 'Embedding' | 'Rendering' | 'Inference' | 'Export';

export interface TaskJobRequest {
  id: string;
  group: WorkerGroupType;
  payload: any;
}

export class JobScheduler {
  private static taskQueues: Map<WorkerGroupType, TaskJobRequest[]> = new Map([
    ['Analysis', []],
    ['Embedding', []],
    ['Rendering', []],
    ['Inference', []],
    ['Export', []],
  ]);

  public static enqueueTask(request: TaskJobRequest) {
    const queue = this.taskQueues.get(request.group) || [];
    queue.push(request);
    this.taskQueues.set(request.group, queue);
  }

  public static processNext(group: WorkerGroupType): TaskJobRequest | undefined {
    const queue = this.taskQueues.get(group);
    return queue?.shift();
  }

  public static getStats() {
    return Array.from(this.taskQueues.entries()).map(([group, queue]) => ({
      group,
      queued: queue.length,
    }));
  }
}
