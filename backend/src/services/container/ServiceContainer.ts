type Constructor<T> = new (...args: any[]) => T;

/**
 * Public surface of T, which is all a consumer of the container can reach. `register` accepts it instead
 * of T itself so a stand-in that is not a subclass (the MOCK_MODE services in src/mock) can be registered
 * under the real class, as long as it implements every public member: classes with private fields are
 * nominal in TypeScript, so nothing but a subclass would match T. A missing member is a compile error.
 */
export type PublicOf<T> = Pick<T, keyof T>;

class ServiceContainer {
	private static instance: ServiceContainer;
	private services: Map<string, any> = new Map();

	private constructor() {}

	public static getInstance(): ServiceContainer {
		if (!ServiceContainer.instance) {
			ServiceContainer.instance = new ServiceContainer();
		}
		return ServiceContainer.instance;
	}

	public register<T>(key: Constructor<T>, service: PublicOf<T>): void {
		this.services.set(key.name, service);
	}

	public get<T>(key: Constructor<T>): T {
		const service = this.services.get(key.name);
		if (!service) {
			throw new Error(`Service ${key.name} not found`);
		}
		return service;
	}
}

export const container = ServiceContainer.getInstance();
