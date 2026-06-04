import { EventEmitter } from "node:events";

export function createEventBus() {
  return new EventEmitter();
}
