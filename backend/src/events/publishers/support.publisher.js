import { publishEvent } from "./publish.js";
import { EXCHANGES } from "../eventNames.js";

export function publishSupportEvent(routingKey, data) {
    return publishEvent(EXCHANGES.SUPPORT, routingKey, data);
}
