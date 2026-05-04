export type RuntimeTaskTrigger = 'init' | 'enter' | 'manual' | string;

export interface RuntimeTaskRunContext {
  signal: AbortSignal | null;
}

export interface RuntimeTaskDefinition<Store = any> {
  trigger?: RuntimeTaskTrigger;
  deps?: string[];
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
