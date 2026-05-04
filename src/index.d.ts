export type RuntimeTaskTrigger = 'init' | 'enter' | 'manual' | string;

export interface RuntimeTaskRunContext {
  signal: AbortSignal | null;
}

export interface RuntimeTaskDefinition<Store = any> {
  /**
   * 谁叫醒这个 task。
   * - 'enter'  默认。每次 mounted / activated 时执行
   * - 'init'   仅首次执行(keep-alive 切回时不重复)
   * - 'manual' 不自动执行,只能通过 $task.run(key) 手动触发
   */
  trigger?: RuntimeTaskTrigger;

  /**
   * 这个 task 当前有没有资格执行。
   *
   * - 必须同步,返回 boolean
   * - 在 abort previous 之后、deps 之前评估
   * - 返回 false 时:不进 run、不开新 loading、不触发 onError;若声明了 reset,同步调用 reset
   * - 不是 watcher,字段变化不会自动重新评估;字段变化仍然要靠 watch / UI 事件叫醒 task
   */
  canRun?(this: Store): boolean;

  /**
   * task 被 skip 时同步触发的清理钩子。
   *
   * skip 的来源:
   *   1. 自己的 canRun 返回 false
   *   2. deps 中任一 task 被 skip
   *
   * 要求:幂等、同步、只做 self cleanup,不发请求。
   *
   * 不触发 reset 的场景:leave / destroy / 手动 abort / run 抛错。
   */
  reset?(this: Store): void;

  /**
   * 极少数"本次执行前必须先 await 前置动作"的场景。
   *
   * deps = run-before,不是 ready-check / once / cache。
   *
   * - 必须是数组
   * - 数组中的 key 必须存在于当前 tasks
   * - 任一 dep 被 skip,当前 task 也会被 skip(并触发自身 reset)
   */
  deps?: string[];

  /** 任务实际执行体。必须接收 { signal } 并传给请求库。 */
  run(this: Store, context: RuntimeTaskRunContext): any | Promise<any>;
}

export type RuntimeTaskMap<Store = any> = Record<string, RuntimeTaskDefinition<Store>>;

export interface RuntimeTaskController {
  run(key: string): Promise<any>;
  abort(key: string): void;
}

export interface RuntimePluginHooks {
  enter?: () => Promise<any>;
  leave?: () => void;
  destroy?: () => void;
}

export interface RuntimePlugin {
  name: 'tasks';
  install(
    store: any,
    taskDefs: RuntimeTaskMap,
    context: { Vue: any }
  ): RuntimePluginHooks | void;
}

export interface RuntimePluginConfig {
  onError?: (error: any, key: string, store: any) => void;
}

export interface RuntimeDefaultPlugin extends RuntimePlugin {
  create(config?: RuntimePluginConfig): RuntimePlugin;
}

declare const taskPlugin: RuntimeDefaultPlugin;

export default taskPlugin;
