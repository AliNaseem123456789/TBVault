import { publishEvent } from "./publish.js";
import { EXCHANGES } from "../eventNames.js";

export function publishOrderEvent(routingKey, data) {
    return publishEvent(EXCHANGES.ORDER, routingKey, data);
}
