import { publishEvent } from "./publish.js";
import { EXCHANGES, CATALOG_EVENTS } from "../eventNames.js";

/**
 * Tells the chatbot's sync worker that products changed, so it re-indexes them.
 *   notifyCatalogChanged({ product_ids: [12] })   or  { seller_id }, { brand_id }, { category_id }
 *
 * Fire-and-forget: a failed publish is logged and never fails the request.
 * The chatbot double-checks every search hit against the database, and
 * `python -m app.cli reindex` repairs anything a lost event missed.
 */
export function notifyCatalogChanged(data) {
    try {
        publishEvent(EXCHANGES.CATALOG, CATALOG_EVENTS.CHANGED, data)
            .catch((err) => console.error("[catalog] publish failed:", err.message));
    } catch (err) {
        console.error("[catalog] publish failed:", err.message);   // RabbitMQ not connected
    }
}
