export class RuntimeEventBus {
    listeners = new Set();
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit(event) {
        const frozen = Object.freeze({ ...event });
        for (const listener of this.listeners) {
            try {
                listener(frozen);
            }
            catch {
                // Runtime fact observers cannot change control flow.
            }
        }
    }
}
