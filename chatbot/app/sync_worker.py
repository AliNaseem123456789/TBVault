"""
Keeps Pinecone in sync with Postgres. Run it next to the API:   python -m app.sync_worker

The Node backend publishes a "catalog.changed" event to RabbitMQ whenever a product,
its photos or options, a seller's approval, or a brand/category name changes:

    {"data": {"product_ids": [12, 13]}}   or   {"data": {"seller_id": 4}}   (also brand_id / category_id)

This worker turns that into product ids and calls indexer.sync_products(ids).

Retries: if indexing fails (Pinecone or the database is down), the message is
published again with an attempt counter and a growing pause (2s, 4s, 8s, ...).
After SYNC_MAX_ATTEMPTS it goes to the "chatbot.catalog-sync.failed" queue so it
isn't lost; `python -m app.cli reindex` repairs everything in any case.
"""
import json
import logging
import time

import pika

from app import catalog, config, indexer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("sync")


def product_ids_for(data):
    if data.get("product_ids"):
        return [int(pid) for pid in data["product_ids"]]
    for key in ("seller_id", "brand_id", "category_id"):
        if data.get(key) is not None:
            return catalog.product_ids_where(**{key: data[key]})
    return []


def handle(body):
    """Process one message. Raises on failure (so it gets retried)."""
    event = json.loads(body)
    ids = product_ids_for(event.get("data") or {})
    if ids:
        report = indexer.sync_products(ids)
        log.info("synced %s products: %s", len(ids), report)


def on_message(channel, method, properties, body):
    attempts = int((properties.headers or {}).get("x-attempts", 0)) + 1
    try:
        handle(body)
    except Exception as err:
        if attempts >= config.SYNC_MAX_ATTEMPTS:
            log.error("giving up after %s attempts: %s", attempts, err)
            target = config.SYNC_FAILED_QUEUE
        else:
            pause = 2 ** attempts
            log.warning("attempt %s failed (%s); retrying in %ss", attempts, err, pause)
            time.sleep(pause)
            target = config.SYNC_QUEUE
        channel.basic_publish(exchange="", routing_key=target, body=body,
                              properties=pika.BasicProperties(headers={"x-attempts": attempts}, delivery_mode=2))
    # Acknowledge last: if this process crashes before here, RabbitMQ redelivers the message.
    channel.basic_ack(delivery_tag=method.delivery_tag)


def main():
    while True:  # reconnect forever if RabbitMQ restarts
        try:
            connection = pika.BlockingConnection(pika.URLParameters(config.RABBITMQ_URL))
            channel = connection.channel()
            channel.exchange_declare(exchange=config.CATALOG_EXCHANGE, exchange_type="topic", durable=True)
            channel.queue_declare(queue=config.SYNC_QUEUE, durable=True)
            channel.queue_declare(queue=config.SYNC_FAILED_QUEUE, durable=True)
            channel.queue_bind(queue=config.SYNC_QUEUE, exchange=config.CATALOG_EXCHANGE, routing_key="catalog.#")
            channel.basic_qos(prefetch_count=1)   # one message at a time
            channel.basic_consume(queue=config.SYNC_QUEUE, on_message_callback=on_message)
            log.info("waiting for catalog changes on %s", config.SYNC_QUEUE)
            channel.start_consuming()
        except KeyboardInterrupt:
            break
        except pika.exceptions.AMQPError as err:
            log.warning("RabbitMQ connection problem (%s); reconnecting in 5s", err)
            time.sleep(5)


if __name__ == "__main__":
    main()
