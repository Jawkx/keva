export class DurableObject<Context = never, Environment = never> {
  protected readonly ctx: Context;
  protected readonly env: Environment;

  constructor(ctx: Context, env: Environment) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint {}
