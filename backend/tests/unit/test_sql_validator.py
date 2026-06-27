import pytest

from src.pipeline.sql_validator import SqlValidator


@pytest.mark.parametrize(
    "sql,expected_ok,expected_stage",
    [
        # --- Valid queries ---
        ("SELECT * FROM orders LIMIT 10", True, None),
        ("SELECT order_id, total_amount FROM orders WHERE status = 'completed'", True, None),
        ("SELECT status, COUNT(*) FROM orders GROUP BY status", True, None),
        (
            "SELECT o.order_id, c.name FROM orders o "
            "JOIN customers c ON o.customer_id = c.customer_id",
            True,
            None,
        ),
        (
            "SELECT * FROM orders WHERE customer_id IN "
            "(SELECT customer_id FROM customers WHERE country = 'US')",
            True,
            None,
        ),
        (
            "WITH top_orders AS "
            "(SELECT * FROM orders ORDER BY total_amount DESC LIMIT 100) "
            "SELECT * FROM top_orders",
            True,
            None,
        ),
        (
            "SELECT order_id, total_amount, "
            "RANK() OVER (PARTITION BY status ORDER BY total_amount DESC) AS rnk "
            "FROM orders",
            True,
            None,
        ),
        (
            "SELECT CASE WHEN total_amount > 100 THEN 'high' ELSE 'low' END AS tier FROM orders",
            True,
            None,
        ),
        (
            "SELECT o.order_id, c.name, p.name, oi.quantity FROM order_items oi "
            "JOIN orders o ON oi.order_id = o.order_id "
            "JOIN customers c ON o.customer_id = c.customer_id "
            "JOIN products p ON oi.product_id = p.product_id",
            True,
            None,
        ),
        ("SELECT COUNT(DISTINCT customer_id) FROM orders", True, None),
        ("SELECT status, COUNT(*) as cnt FROM orders GROUP BY status HAVING cnt > 100", True, None),
        ("SELECT * FROM products ORDER BY list_price DESC LIMIT 20", True, None),
        ("SELECT UPPER(name), LENGTH(email) FROM customers", True, None),
        ("SELECT YEAR(order_date), MONTH(order_date) FROM orders", True, None),
        ("SELECT STRFTIME(order_date, '%Y-%m') AS month FROM orders", True, None),
        # --- Injection/Deny attempts (safety failures) ---
        ("DROP TABLE orders", False, "safety"),
        ("DELETE FROM orders WHERE order_id = 1", False, "safety"),
        ("INSERT INTO customers (name) VALUES ('hacker')", False, "safety"),
        ("UPDATE orders SET status = 'completed'", False, "safety"),
        ("SELECT 1; DROP TABLE orders", False, "safety"),
        ("CREATE TABLE evil (id INT)", False, "safety"),
        ("ATTACH DATABASE 'evil.db'", False, "safety"),
        # --- Structural errors ---
        ("SELECT * FROM nonexistent_table", False, "structural"),
        ("SELECT fake_column FROM orders", False, "structural"),
        ("SELECT * FROM oder", False, "structural"),
        ("SELECT order_idd FROM orders", False, "structural"),
        # --- Syntax errors ---
        ("SELECT (1 + 2 FROM orders", False, "syntax"),
        ("SELECT order_id WHERE status = 'ok'", False, "structural"),
        ("SELEKT * FROM orders", False, "syntax"),
        ("", False, "syntax"),
        ("   ", False, "syntax"),
        # --- Edge cases ---
        ("SELECT o.order_id FROM orders o", True, None),
        ("WITH cte AS (SELECT customer_id AS cid FROM customers) SELECT cid FROM cte", True, None),
        ("SELECT name FROM (SELECT name FROM customers) AS sub", True, None),
        ("SELECT 1", True, None),
        ("SELECT order_id -- main id\nFROM orders", True, None),
        ("SELECT * FROM orders WHERE status = 'drop'", True, None),
        ("SELECT * FROM orders;", True, None),
        (
            "SELECT o.order_id, p.name FROM order_items oi "
            "JOIN orders o ON oi.order_id = o.order_id "
            "JOIN products p ON oi.product_id = p.product_id",
            True,
            None,
        ),
        (
            "SELECT order_id FROM orders WHERE status='completed' "
            "UNION ALL SELECT order_id FROM orders WHERE status='returned'",
            True,
            None,
        ),
        (
            "SELECT * FROM orders o WHERE EXISTS "
            "(SELECT 1 FROM customers c WHERE c.customer_id = o.customer_id)",
            True,
            None,
        ),
        ("SELECT COALESCE(total_amount, 0), NULLIF(status, 'pending') FROM orders", True, None),
        ("SELECT DISTINCT status FROM orders", True, None),
    ],
)
def test_validate(sql, expected_ok, expected_stage, schema_context):
    validator = SqlValidator()
    result = validator.validate(sql, schema_context)
    assert result.ok == expected_ok
    if expected_stage:
        assert result.stage == expected_stage
