import { bindControlledInput, bindControlledSelect, SelectOption, Signal, WritableSignal } from 'chispa';

// TODO: T extend InputValueType; no usar any, especificar tipo real, esto se podra hacer cuando chispa exponga esos tipos

export function bindInput<T>(valueSignal: WritableSignal<T>, options?: any) {
	return (el: HTMLInputElement) => {
		bindControlledInput<any>(el, valueSignal, options);
	};
}

export function bindSelect(valueSignal: WritableSignal<string>, optionList?: Signal<SelectOption[]> | SelectOption[]) {
	return (el: HTMLSelectElement) => {
		bindControlledSelect(el, valueSignal, optionList);
	};
}
