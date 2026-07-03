import crypto from 'crypto';
import fs from 'fs';
import { EventBus } from '../services/EventBus';

export interface DAGNode {
  id: string;
  name: string;
  dependencies: string[];
  execute: (context: Record<string, any>) => Promise<Record<string, any>>;
}

export class DAGScheduler {
  private cacheMap: Map<string, { hash: string; output: Record<string, any> }> = new Map();

  public computeHash(nodeId: string, inputParams: Record<string, any>, depHashes: string[]): string {
    const dataStr = JSON.stringify({ nodeId, inputParams, depHashes });
    return crypto.createHash('sha256').update(dataStr).digest('hex');
  }

  public async executeGraph(
    jobId: string,
    nodes: DAGNode[],
    initialContext: Record<string, any>
  ): Promise<{ results: Record<string, any>; executionTimes: Record<string, number> }> {
    const context: Record<string, any> = { ...initialContext };
    const nodeHashes: Map<string, string> = new Map();
    const executionTimes: Record<string, number> = {};
    const completed: Set<string> = new Set();
    const executing: Set<string> = new Set();

    EventBus.publish('JobUpdated', { jobId, status: 'processing', timestamp: Date.now() });

    const runNode = async (node: DAGNode): Promise<void> => {
      executing.add(node.id);
      const startTime = Date.now();

      EventBus.publish('StageStarted', { jobId, stageName: node.name, timestamp: startTime });

      const depHashes = node.dependencies.map(d => nodeHashes.get(d) || '');
      const currentHash = this.computeHash(node.id, context[node.id] || {}, depHashes);
      nodeHashes.set(node.id, currentHash);

      const cached = this.cacheMap.get(currentHash);
      if (cached) {
        EventBus.publish('StageSkipped', { jobId, stageName: node.name, cached: true, timestamp: Date.now() });
        context[node.id] = cached.output;
        executionTimes[node.id] = 0;
        completed.add(node.id);
        executing.delete(node.id);
        return;
      }

      try {
        const output = await node.execute(context);
        const duration = Date.now() - startTime;
        executionTimes[node.id] = duration;
        context[node.id] = output;
        this.cacheMap.set(currentHash, { hash: currentHash, output });

        completed.add(node.id);
        executing.delete(node.id);
        EventBus.publish('StageCompleted', { jobId, stageName: node.name, duration, timestamp: Date.now() });
      } catch (err: any) {
        executing.delete(node.id);
        EventBus.publish('StageFailed', { jobId, stageName: node.name, error: err.message, timestamp: Date.now() });
        throw err;
      }
    };

    while (completed.size < nodes.length) {
      const readyNodes = nodes.filter(node => 
        !completed.has(node.id) && 
        !executing.has(node.id) && 
        node.dependencies.every(dep => completed.has(dep))
      );

      if (readyNodes.length === 0 && executing.size === 0) {
        throw new Error('Cyclic dependency or unresolvable node in DAG pipeline');
      }

      if (readyNodes.length > 0) {
        await Promise.all(readyNodes.map(node => runNode(node)));
      } else {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return { results: context, executionTimes };
  }
}
