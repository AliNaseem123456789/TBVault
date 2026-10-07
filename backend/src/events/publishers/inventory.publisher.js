import { publishEvent } from "./publish.js";
import { EXCHANGES } from "../eventNames.js";

export function publishInventoryEvent(routingKey, data) {
    return publishEvent(EXCHANGES.INVENTORY, routingKey, data);
}
