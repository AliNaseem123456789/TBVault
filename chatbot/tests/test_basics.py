"""Pure logic, no database: BM25, the chat-message parser, product text."""
import math

from app.bm25 import BM25, tokenize
from app.query_parser import parse
from app.text_builder import product_document

BRANDS = [{"id": 1, "name": "Samsung"}, {"id": 2, "name": "Apple"}]
CATEGORIES = [{"id": 10, "name": "Smartphones"}, {"id": 11, "name": "Kitchen Accessories"}]


def test_tokenize_keeps_model_numbers_matchable():
    assert "whch720n" in tokenize("Sony WH-CH720N")
    assert "whch720n" in tokenize("whch720n")
    assert set(tokenize("WH CH720N")) & set(tokenize("WH-CH720N")) == {"wh", "ch720n"}
    assert tokenize("phones and cases") == ["phone", "case"]   # stopword dropped, plural trimmed
    assert tokenize("glass") == ["glass"]


def test_sparse_dot_product_equals_textbook_bm25():
    docs = ["red apple juice", "green apple", "red car red paint", "blue sky"]
    model = BM25().fit(docs)
    query = model.encode_query("red apple")
    for doc in docs:
        vec = model.encode_document(doc)
        dot = sum(qv * dict(zip(vec["indices"], vec["values"])).get(qi, 0)
                  for qi, qv in zip(query["indices"], query["values"]))
        # textbook BM25
        tokens = tokenize(doc)
        expected = 0.0
        for word in {"red", "apple"}:
            tf = tokens.count(word)
            if tf:
                norm = 1.2 * (1 - 0.75 + 0.75 * len(tokens) / model.avg_len)
                expected += model.idf(word) * tf * 2.2 / (tf + norm)
        assert math.isclose(dot, expected, rel_tol=1e-9)


def test_rare_words_weigh_more():
    model = BM25().fit(["red shirt", "red shoe", "red hat", "blue hat"])
    assert model.idf("blue") > model.idf("red")


def test_bm25_save_and_load(tmp_path):
    model = BM25().fit(["a red shoe", "a blue hat"])
    model.save(tmp_path / "p.json")
    again = BM25.load(tmp_path / "p.json")
    assert again.encode_query("red hat") == model.encode_query("red hat")


def test_parse_prices_stock_and_sale():
    text, f = parse("Samsung smartphones under $300 in stock on sale", BRANDS, CATEGORIES)
    assert f.max_price == 300 and f.min_price is None
    assert f.in_stock and f.on_sale
    assert f.brand_id == 1 and f.category_id == 10
    assert f.guessed == ["brand_id", "category_id"]
    assert "300" not in text and "samsung" in text

    _, f = parse("between 50 and 150", BRANDS, CATEGORIES)
    assert (f.min_price, f.max_price) == (50, 150)
    _, f = parse("$200-$100 range", BRANDS, CATEGORIES)
    assert (f.min_price, f.max_price) == (100, 200)
    _, f = parse("laptop over 1,200", BRANDS, CATEGORIES)
    assert f.min_price == 1200


def test_parse_plain_question_has_no_filters():
    text, f = parse("something to make eyelashes longer", BRANDS, CATEGORIES)
    assert f.describe() == {}
    assert text == "something to make eyelashes longer"


def test_parse_category_singular_and_words_only():
    _, f = parse("a smartphone for my mum", BRANDS, CATEGORIES)
    assert f.category_id == 10
    _, f = parse("pineapple", BRANDS, CATEGORIES)   # 'apple' inside another word is not the brand
    assert f.brand_id is None


def test_product_document_puts_context_first():
    row = {"name": "WH-CH720N", "category_name": "Headphones", "brand_name": "Sony", "seller_name": "TBVault",
           "variants": [{"name": "Black"}, {"name": "White"}], "description": "Wireless\n\n noise  cancelling."}
    doc = product_document(row)
    assert doc == ("Product: WH-CH720N. Category: Headphones. Brand: Sony. Sold by: TBVault. "
                   "Options: Black, White. Description: Wireless noise cancelling.")
