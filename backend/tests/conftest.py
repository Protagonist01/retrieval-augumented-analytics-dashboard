from pathlib import Path
from unittest.mock import AsyncMock

import duckdb
import pytest

from src.config import Settings
from src.pipeline.schema_retriever import SchemaColumn, SchemaContext, SchemaTable


@pytest.fixture
def mock_settings():
    return Settings(
        llm_provider="openai",
        openai_api_key="mock-key-12345",
        openai_model="gpt-4o",
        openai_max_tokens=128,
        duckdb_data_dir=Path("./data/sample"),
        max_result_rows=100,
        query_timeout_seconds=2,
        redis_url="redis://localhost:6379",
        schema_cache_ttl_seconds=10,
        query_cache_ttl_seconds=10,
        api_host="0.0.0.0",
        api_port=8000,
        cors_origins=["http://localhost:3000"],
        log_level="DEBUG",
        log_format="pretty",
    )


@pytest.fixture
def mock_redis():
    client = AsyncMock()
    client.get.return_value = None
    client.set.return_value = True
    client.ping.return_value = True
    return client


@pytest.fixture
def schema_context():
    return SchemaContext(
        tables=[
            SchemaTable(
                name="customers",
                columns=[
                    SchemaColumn(name="customer_id", type="BIGINT", sample_values=["1", "2", "3"]),
                    SchemaColumn(
                        name="name", type="VARCHAR", sample_values=["Alice", "Bob", "Charlie"]
                    ),
                    SchemaColumn(
                        name="email", type="VARCHAR", sample_values=["a@test.com", "b@test.com"]
                    ),
                    SchemaColumn(name="city", type="VARCHAR", sample_values=["New York", "Paris"]),
                    SchemaColumn(name="country", type="VARCHAR", sample_values=["US", "FR"]),
                    SchemaColumn(
                        name="signup_date", type="DATE", sample_values=["2023-01-15", "2023-05-20"]
                    ),
                ],
                foreign_keys=[],
            ),
            SchemaTable(
                name="products",
                columns=[
                    SchemaColumn(name="product_id", type="BIGINT", sample_values=["101", "102"]),
                    SchemaColumn(name="name", type="VARCHAR", sample_values=["Laptop", "Phone"]),
                    SchemaColumn(
                        name="category", type="VARCHAR", sample_values=["Electronics", "Clothing"]
                    ),
                    SchemaColumn(
                        name="subcategory", type="VARCHAR", sample_values=["Computers", "Outerwear"]
                    ),
                    SchemaColumn(name="cost_price", type="DOUBLE", sample_values=["500.0", "20.0"]),
                    SchemaColumn(
                        name="list_price", type="DOUBLE", sample_values=["799.99", "39.99"]
                    ),
                ],
                foreign_keys=[],
            ),
            SchemaTable(
                name="orders",
                columns=[
                    SchemaColumn(name="order_id", type="BIGINT", sample_values=["1001", "1002"]),
                    SchemaColumn(name="customer_id", type="BIGINT", sample_values=["1", "2"]),
                    SchemaColumn(
                        name="order_date", type="DATE", sample_values=["2024-01-10", "2024-02-15"]
                    ),
                    SchemaColumn(
                        name="status",
                        type="VARCHAR",
                        sample_values=["completed", "shipped", "pending"],
                    ),
                    SchemaColumn(
                        name="payment_method",
                        type="VARCHAR",
                        sample_values=["credit_card", "paypal"],
                    ),
                    SchemaColumn(
                        name="shipping_city", type="VARCHAR", sample_values=["New York", "London"]
                    ),
                    SchemaColumn(
                        name="shipping_country", type="VARCHAR", sample_values=["US", "UK"]
                    ),
                    SchemaColumn(
                        name="total_amount", type="DOUBLE", sample_values=["839.98", "39.99"]
                    ),
                ],
                foreign_keys=[
                    {"column": "customer_id", "ref_table": "customers", "ref_column": "customer_id"}
                ],
            ),
            SchemaTable(
                name="order_items",
                columns=[
                    SchemaColumn(name="item_id", type="BIGINT", sample_values=["5001", "5002"]),
                    SchemaColumn(name="order_id", type="BIGINT", sample_values=["1001", "1002"]),
                    SchemaColumn(name="product_id", type="BIGINT", sample_values=["101", "102"]),
                    SchemaColumn(name="quantity", type="BIGINT", sample_values=["1", "2"]),
                    SchemaColumn(
                        name="unit_price", type="DOUBLE", sample_values=["799.99", "19.99"]
                    ),
                    SchemaColumn(name="discount_pct", type="DOUBLE", sample_values=["0.0", "10.0"]),
                ],
                foreign_keys=[
                    {"column": "order_id", "ref_table": "orders", "ref_column": "order_id"},
                    {"column": "product_id", "ref_table": "products", "ref_column": "product_id"},
                ],
            ),
        ]
    )


@pytest.fixture
def in_memory_duckdb():
    conn = duckdb.connect(":memory:")

    # Create tables
    conn.execute("""
        CREATE TABLE customers (
            customer_id BIGINT PRIMARY KEY,
            name VARCHAR,
            email VARCHAR,
            city VARCHAR,
            country VARCHAR,
            signup_date DATE
        );
        CREATE TABLE products (
            product_id BIGINT PRIMARY KEY,
            name VARCHAR,
            category VARCHAR,
            subcategory VARCHAR,
            cost_price DOUBLE,
            list_price DOUBLE
        );
        CREATE TABLE orders (
            order_id BIGINT PRIMARY KEY,
            customer_id BIGINT,
            order_date DATE,
            status VARCHAR,
            payment_method VARCHAR,
            shipping_city VARCHAR,
            shipping_country VARCHAR,
            total_amount DOUBLE
        );
        CREATE TABLE order_items (
            item_id BIGINT PRIMARY KEY,
            order_id BIGINT,
            product_id BIGINT,
            quantity BIGINT,
            unit_price DOUBLE,
            discount_pct DOUBLE
        );
    """)

    # Populate customers (10 rows)
    conn.execute("""
        INSERT INTO customers VALUES
        (1, 'Alice Smith', 'alice@example.com', 'New York', 'US', '2023-01-15'),
        (2, 'Bob Jones', 'bob@example.com', 'San Francisco', 'US', '2023-03-22'),
        (3, 'Charlie Brown', 'charlie@example.com', 'London', 'UK', '2023-06-10'),
        (4, 'David Evans', 'david@example.com', 'Paris', 'FR', '2023-09-01'),
        (5, 'Emma Wood', 'emma@example.com', 'Berlin', 'DE', '2023-11-15'),
        (6, 'Fiona Gallagher', 'fiona@example.com', 'Dublin', 'IE', '2024-01-10'),
        (7, 'George Clark', 'george@example.com', 'Toronto', 'CA', '2024-02-28'),
        (8, 'Hannah Abbott', 'hannah@example.com', 'Sydney', 'AU', '2024-04-12'),
        (9, 'Ian Malcolm', 'ian@example.com', 'Boston', 'US', '2024-05-18'),
        (10, 'Julia Roberts', 'julia@example.com', 'Los Angeles', 'US', '2024-06-01');
    """)

    # Populate products (10 rows)
    conn.execute("""
        INSERT INTO products VALUES
        (101, 'MacBook Pro', 'Electronics', 'Laptops', 1500.00, 1999.99),
        (102, 'iPhone 15', 'Electronics', 'Smartphones', 600.00, 799.99),
        (103, 'Leather Jacket', 'Clothing', 'Jackets', 120.00, 249.99),
        (104, 'Running Shoes', 'Clothing', 'Shoes', 45.00, 89.99),
        (105, 'Coffee Maker', 'Home', 'Kitchenware', 35.00, 79.99),
        (106, 'Desk Lamp', 'Home', 'Lighting', 15.00, 29.99),
        (107, 'Python Guide', 'Books', 'Programming', 20.00, 39.99),
        (108, 'Sci-Fi Novel', 'Books', 'Fiction', 8.00, 14.99),
        (109, 'Yoga Mat', 'Sports', 'Fitness', 12.00, 24.99),
        (110, 'Dumbbell Set', 'Sports', 'Fitness', 30.00, 59.99);
    """)

    # Populate orders (50 rows)
    for i in range(1, 51):
        cust_id = (i % 10) + 1
        amount = 50.0 + (i * 12.5)
        # alternate statuses: completed, shipped, pending, cancelled, returned
        statuses = ["completed", "shipped", "pending", "cancelled", "returned"]
        status = statuses[i % 5]
        pay_methods = ["credit_card", "paypal", "apple_pay"]
        pay_method = pay_methods[i % 3]
        date_str = f"2024-0{(i % 9) + 1}-{(i % 28) + 1:02d}"
        conn.execute(
            "INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                1000 + i,
                cust_id,
                date_str,
                status,
                pay_method,
                f"City {cust_id}",
                f"Country {cust_id}",
                amount,
            ],
        )

    # Populate order_items (100 rows)
    for i in range(1, 101):
        order_id = 1000 + ((i % 50) + 1)
        prod_id = 100 + ((i % 10) + 1)
        qty = (i % 3) + 1
        price = 19.99 + (i * 2.5)
        conn.execute(
            "INSERT INTO order_items VALUES (?, ?, ?, ?, ?, ?)",
            [5000 + i, order_id, prod_id, qty, price, 0.0],
        )

    yield conn
    conn.close()
