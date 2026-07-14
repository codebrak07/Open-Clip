export type CommandType =
  | 'RunJob'
  | 'CancelJob'
  | 'RetryStage'
  | 'PauseJob'
  | 'ResumeJob';

export interface Command {
  type: CommandType;
  jobId: string;
  payload?: any;
}

export type CommandHandler = (command: Command) => Promise<void>;

export class CommandBus {
  private static handlers: Map<CommandType, CommandHandler> = new Map();

  static register(type: CommandType, handler: CommandHandler) {
    this.handlers.set(type, handler);
  }

  static async dispatch(command: Command): Promise<void> {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      throw new Error(`No command handler registered for command: ${command.type}`);
    }
    console.log(`[CommandBus] Dispatching command ${command.type} for job ${command.jobId}`);
    await handler(command);
  }
}
