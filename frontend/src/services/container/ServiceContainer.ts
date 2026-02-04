type Constructor<T> = new (...args: any[]) => T;

class ServiceContainer {
	private services = new Map<Constructor<any>, any>();

	public constructor() {}

	public register<T>(ctor: Constructor<T>, service: T): void {
		this.services.set(ctor, service);
	}

	public get<T>(ctor: Constructor<T>): T {
		let service = this.services.get(ctor);
		if (!service) {
			service = new ctor();
			this.register(ctor, service);
		}
		return service;
	}
}

export const services = new ServiceContainer();
