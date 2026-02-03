type Constructor<T> = new (...args: any[]) => T;

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

	public register<T>(key: Constructor<T>, service: T): void {
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
