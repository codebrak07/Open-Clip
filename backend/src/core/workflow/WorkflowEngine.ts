import { EventBus } from '../../services/EventBus';
import { Logger } from '../../utils/Logger';

export interface WorkflowTask {
  id: string;
  name: string;
  dependencies: string[];
  execute: (context: Record<string, any>) => Promise<Record<string, any>>;
}

export class WorkflowEngine {
  public static async executeWorkflow(
    jobId: string,
    tasks: WorkflowTask[],
    initialContext: Record<string, any> = {}
  ): Promise<Record<string, any>> {
    const context = { ...initialContext };
    const completed = new Set<string>();

    Logger.info(`[WorkflowEngine] Starting deterministic workflow execution for job ${jobId}`);

    while (completed.size < tasks.length) {
      const readyTasks = tasks.filter(
        t => !completed.has(t.id) && t.dependencies.every(dep => completed.has(dep))
      );

      if (readyTasks.length === 0 && completed.size < tasks.length) {
        throw new Error(`[WorkflowEngine] Cyclic or unresolvable task dependency graph in job ${jobId}`);
      }

      for (const task of readyTasks) {
        const start = Date.now();
        Logger.info(`[WorkflowEngine] Executing task ${task.name}`);
        const output = await task.execute(context);
        context[task.id] = output;
        completed.add(task.id);

        const duration = Date.now() - start;
        EventBus.publish('StageCompleted', { jobId, stageName: task.name, duration, timestamp: Date.now() });
      }
    }

    return context;
  }
}
