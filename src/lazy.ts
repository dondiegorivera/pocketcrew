// A record built on first use. Core's registries (the fleet, tools, kits, MCP servers, repo views) merge the enabled
// plugins, and plugins import core: built while modules are still loading, a registry would read a plugin that is not
// there yet. Built on first use, inside a function call, everything is loaded. The record reads like a plain object.
export function lazy<T extends object>(make: () => T): T {
	let value: T | undefined;
	const get = () => (value ??= make());
	return new Proxy({} as T, {
		get: (_t, key) => Reflect.get(get(), key),
		has: (_t, key) => Reflect.has(get(), key),
		ownKeys: () => Reflect.ownKeys(get()),
		getOwnPropertyDescriptor: (_t, key) => {
			const d = Reflect.getOwnPropertyDescriptor(get(), key);
			return d && { ...d, configurable: true };
		},
		set: () => false,
		deleteProperty: () => false,
	});
}
