import { publishEvent } from "./publish.js";
import { EXCHANGES } from "../eventNames.js";

export function publishAuthEvents(routingKey, data) {
    return publishEvent(EXCHANGES.AUTH, routingKey, data);
}
