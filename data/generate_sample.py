"""
generate_sample.py
──────────────────
Generates a realistic synthetic e-commerce dataset for the RAA Dashboard demo.

Output files (written to data/sample/):
  customers.csv   — 500 customers
  products.csv    — 200 products across 5 categories
  orders.csv      — 5,000 orders over 2 years
  order_items.csv — ~12,500 order items (avg 2.5 per order)

All randomness is seeded (SEED = 42) so results are fully reproducible.
Run: python data/generate_sample.py
"""

import csv
import math
import os
import random
from datetime import date, timedelta
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
SEED = 42
OUTPUT_DIR = Path(__file__).parent / "sample"

N_CUSTOMERS = 500
N_PRODUCTS = 200
N_ORDERS = 5_000
ORDER_DATE_START = date(2023, 1, 1)
ORDER_DATE_END = date(2024, 12, 31)

# ── Seed ──────────────────────────────────────────────────────────────────────
rng = random.Random(SEED)

# ── Reference Data ────────────────────────────────────────────────────────────
CATEGORIES = {
    "Electronics": {
        "subcategories": ["Laptops", "Smartphones", "Headphones", "Cameras", "Tablets"],
        "price_range": (49.99, 2499.99),
        "margin": 0.25,
    },
    "Clothing": {
        "subcategories": ["T-Shirts", "Jeans", "Jackets", "Shoes", "Accessories"],
        "price_range": (9.99, 349.99),
        "margin": 0.55,
    },
    "Home": {
        "subcategories": ["Furniture", "Kitchenware", "Bedding", "Lighting", "Storage"],
        "price_range": (14.99, 999.99),
        "margin": 0.45,
    },
    "Books": {
        "subcategories": ["Fiction", "Non-Fiction", "Technical", "Children", "Self-Help"],
        "price_range": (4.99, 69.99),
        "margin": 0.35,
    },
    "Sports": {
        "subcategories": ["Fitness", "Outdoor", "Team Sports", "Water Sports", "Cycling"],
        "price_range": (9.99, 799.99),
        "margin": 0.40,
    },
}

FIRST_NAMES = [
    "Emma", "Liam", "Olivia", "Noah", "Ava", "Isabella", "Sophia", "Mia",
    "Charlotte", "Amelia", "Harper", "Evelyn", "Abigail", "Emily", "Elizabeth",
    "James", "William", "Benjamin", "Lucas", "Henry", "Alexander", "Mason",
    "Ethan", "Daniel", "Jacob", "Logan", "Jackson", "Sebastian", "Jack", "Aiden",
    "Sofia", "Luna", "Camila", "Grace", "Chloe", "Penelope", "Layla", "Riley",
    "Zoey", "Nora", "Lily", "Eleanor", "Hannah", "Lillian", "Addison", "Aubrey",
    "Ellie", "Stella", "Natalie", "Zoe", "Leah", "Hazel", "Violet", "Aurora",
    "Savannah", "Audrey", "Brooklyn", "Bella", "Claire", "Skylar", "Lucy",
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
    "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
    "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
    "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
    "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King",
    "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green",
    "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
    "Carter", "Roberts",
]

CITIES = [
    ("New York", "US"), ("Los Angeles", "US"), ("Chicago", "US"), ("Houston", "US"),
    ("Phoenix", "US"), ("Philadelphia", "US"), ("San Antonio", "US"), ("San Diego", "US"),
    ("Dallas", "US"), ("San Jose", "US"), ("Austin", "US"), ("Jacksonville", "US"),
    ("London", "GB"), ("Manchester", "GB"), ("Birmingham", "GB"), ("Leeds", "GB"),
    ("Glasgow", "GB"), ("Liverpool", "GB"), ("Bristol", "GB"), ("Sheffield", "GB"),
    ("Toronto", "CA"), ("Vancouver", "CA"), ("Montreal", "CA"), ("Calgary", "CA"),
    ("Ottawa", "CA"), ("Edmonton", "CA"), ("Winnipeg", "CA"), ("Quebec City", "CA"),
    ("Sydney", "AU"), ("Melbourne", "AU"), ("Brisbane", "AU"), ("Perth", "AU"),
    ("Adelaide", "AU"), ("Gold Coast", "AU"), ("Canberra", "AU"), ("Hobart", "AU"),
    ("Berlin", "DE"), ("Munich", "DE"), ("Hamburg", "DE"), ("Cologne", "DE"),
    ("Paris", "FR"), ("Lyon", "FR"), ("Marseille", "FR"), ("Toulouse", "FR"),
]

ORDER_STATUSES = ["completed", "shipped", "pending", "cancelled", "returned"]
STATUS_WEIGHTS = [0.60, 0.20, 0.10, 0.07, 0.03]

PAYMENT_METHODS = ["credit_card", "debit_card", "paypal", "apple_pay", "google_pay"]
PAYMENT_WEIGHTS = [0.40, 0.25, 0.20, 0.10, 0.05]


# ── Helpers ───────────────────────────────────────────────────────────────────

def weighted_choice(choices, weights):
    total = sum(weights)
    r = rng.uniform(0, total)
    cumulative = 0
    for c, w in zip(choices, weights):
        cumulative += w
        if r <= cumulative:
            return c
    return choices[-1]


def pareto_product_weights(n: int) -> list[float]:
    """Top 20% of products get 80% of order weight (Pareto)."""
    weights = []
    for i in range(n):
        rank = i + 1
        weight = 1.0 / (rank ** 0.7)
        weights.append(weight)
    total = sum(weights)
    return [w / total for w in weights]


def random_date(start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=rng.randint(0, delta))


def random_email(first: str, last: str, uid: int) -> str:
    domains = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com", "proton.me"]
    domain = rng.choice(domains)
    variations = [
        f"{first.lower()}.{last.lower()}",
        f"{first.lower()}{uid}",
        f"{last.lower()}.{first[0].lower()}{uid}",
        f"{first.lower()}_{last.lower()}",
    ]
    return f"{rng.choice(variations)}@{domain}"


# ── Generators ────────────────────────────────────────────────────────────────

def generate_customers() -> list[dict]:
    customers = []
    for i in range(1, N_CUSTOMERS + 1):
        first = rng.choice(FIRST_NAMES)
        last = rng.choice(LAST_NAMES)
        city, country = rng.choice(CITIES)
        signup = random_date(date(2021, 1, 1), ORDER_DATE_START)
        customers.append({
            "customer_id": i,
            "name": f"{first} {last}",
            "email": random_email(first, last, i),
            "city": city,
            "country": country,
            "signup_date": signup.isoformat(),
        })
    return customers


def generate_products() -> list[dict]:
    products = []
    product_id = 1
    per_category = N_PRODUCTS // len(CATEGORIES)

    adjectives = [
        "Pro", "Elite", "Ultra", "Premium", "Essential", "Classic",
        "Smart", "Lite", "Max", "Plus", "Advanced", "Compact",
    ]
    nouns_by_cat = {
        "Electronics": ["Hub", "Module", "Device", "Station", "Kit", "System"],
        "Clothing": ["Collection", "Series", "Edition", "Line", "Set", "Bundle"],
        "Home": ["Solution", "Set", "Kit", "Collection", "Series", "Pack"],
        "Books": ["Guide", "Handbook", "Manual", "Compendium", "Edition", "Volume"],
        "Sports": ["Gear", "Kit", "Pack", "Set", "System", "Series"],
    }

    for cat_name, cat_info in CATEGORIES.items():
        subcats = cat_info["subcategories"]
        price_min, price_max = cat_info["price_range"]
        margin = cat_info["margin"]
        nouns = nouns_by_cat[cat_name]

        for j in range(per_category):
            subcat = subcats[j % len(subcats)]
            adj = rng.choice(adjectives)
            noun = rng.choice(nouns)
            name = f"{subcat} {adj} {noun} {rng.randint(100, 999)}"

            list_price = round(rng.uniform(price_min, price_max), 2)
            cost_price = round(list_price * (1 - margin) * rng.uniform(0.85, 1.0), 2)

            products.append({
                "product_id": product_id,
                "name": name,
                "category": cat_name,
                "subcategory": subcat,
                "cost_price": cost_price,
                "list_price": list_price,
            })
            product_id += 1

    return products


def generate_orders_and_items(
    customers: list[dict], products: list[dict]
) -> tuple[list[dict], list[dict]]:
    orders = []
    order_items = []
    item_id = 1

    customer_ids = [c["customer_id"] for c in customers]
    product_ids = [p["product_id"] for p in products]
    product_prices = {p["product_id"]: p["list_price"] for p in products}

    # Pareto weight — some customers order much more than others
    customer_weights = pareto_product_weights(len(customer_ids))
    # Pareto weight — some products are ordered much more
    product_weights = pareto_product_weights(len(product_ids))

    for order_id in range(1, N_ORDERS + 1):
        customer_id = rng.choices(customer_ids, weights=customer_weights, k=1)[0]
        city, country = rng.choice(CITIES)
        order_date = random_date(ORDER_DATE_START, ORDER_DATE_END)
        status = weighted_choice(ORDER_STATUSES, STATUS_WEIGHTS)
        payment = weighted_choice(PAYMENT_METHODS, PAYMENT_WEIGHTS)

        # 1–5 items per order, avg ~2.5
        n_items = rng.choices([1, 2, 3, 4, 5], weights=[0.25, 0.35, 0.22, 0.12, 0.06], k=1)[0]
        chosen_products = rng.choices(product_ids, weights=product_weights, k=n_items)

        order_total = 0.0
        for pid in chosen_products:
            qty = rng.choices([1, 2, 3, 4], weights=[0.55, 0.28, 0.12, 0.05], k=1)[0]
            base_price = product_prices[pid]
            # Occasional discount (20% chance)
            discount_pct = rng.choice([0, 0, 0, 0, 5, 10, 15, 20]) if rng.random() < 0.2 else 0
            unit_price = round(base_price * (1 - discount_pct / 100), 2)
            line_total = round(unit_price * qty, 2)
            order_total += line_total

            order_items.append({
                "item_id": item_id,
                "order_id": order_id,
                "product_id": pid,
                "quantity": qty,
                "unit_price": unit_price,
                "discount_pct": discount_pct,
            })
            item_id += 1

        orders.append({
            "order_id": order_id,
            "customer_id": customer_id,
            "order_date": order_date.isoformat(),
            "status": status,
            "payment_method": payment,
            "shipping_city": city,
            "shipping_country": country,
            "total_amount": round(order_total, 2),
        })

    return orders, order_items


# ── Writer ────────────────────────────────────────────────────────────────────

def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"  OK  {path.name:25s}  {len(rows):>6,} rows")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("Generating synthetic e-commerce dataset (seed=42)…")

    customers = generate_customers()
    products = generate_products()
    orders, order_items = generate_orders_and_items(customers, products)

    write_csv(OUTPUT_DIR / "customers.csv", customers)
    write_csv(OUTPUT_DIR / "products.csv", products)
    write_csv(OUTPUT_DIR / "orders.csv", orders)
    write_csv(OUTPUT_DIR / "order_items.csv", order_items)

    total_revenue = sum(
        o["total_amount"] for o in orders if o["status"] == "completed"
    )
    print(f"\nSummary:")
    print(f"  Customers   : {len(customers):,}")
    print(f"  Products    : {len(products):,}")
    print(f"  Orders      : {len(orders):,}")
    print(f"  Order items : {len(order_items):,}")
    print(f"  Completed revenue: ${total_revenue:,.2f}")
    print(f"\nOutput directory: {OUTPUT_DIR.resolve()}")


if __name__ == "__main__":
    main()
