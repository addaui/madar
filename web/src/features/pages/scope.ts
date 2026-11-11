/** Whose pages: your own (the `pages.*` operations, in a Space) or a project's Knowledge (the `knowledge.*` operations, in the project). */
export type PageScope = { project?: undefined; space: string } | { project: string; space?: undefined };

export const ownScope = (space: string): PageScope => ({ space });
export const projectScope = (project: string): PageScope => ({ project });

/** The operation for a scope: `pages.list` or `knowledge.list`. */
export const opOf = (scope: PageScope, name: string): string => (scope.project ? "knowledge." : "pages.") + name;

/** The input of an operation for a scope: a project's Knowledge always names its project. */
export const inputOf = <T extends object>(scope: PageScope, input: T): T & { project?: string } => (scope.project ? { ...input, project: scope.project } : input);

/** The cache key of a read, matching what `useRead` and the router's loaders use. */
export const keyOf = (scope: PageScope, name: string, input: object = {}): [string, object] => [opOf(scope, name), inputOf(scope, input)];
