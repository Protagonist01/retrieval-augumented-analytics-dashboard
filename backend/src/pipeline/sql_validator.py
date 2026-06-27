import difflib
import logging
from dataclasses import dataclass

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from src.pipeline.schema_retriever import SchemaContext

logger = logging.getLogger("raa.sql_validator")


@dataclass
class ValidationResult:
    ok: bool
    error: str | None = None
    stage: str | None = None


class SqlValidator:
    def validate(self, sql: str, schema_context: SchemaContext) -> ValidationResult:
        if not sql or not sql.strip():
            return ValidationResult(ok=False, error="SQL query is empty", stage="syntax")

        # Stage 1: Syntactic validation
        try:
            # We use parse because a query might contain multiple statements.
            # parse() returns a list of ASTs.
            expressions = sqlglot.parse(sql, read="duckdb")
        except ParseError as e:
            logger.warning(f"SQL syntax validation failed: {e}")
            return ValidationResult(ok=False, error=str(e), stage="syntax")
        except Exception as e:
            logger.warning(f"Unexpected parser error: {e}")
            return ValidationResult(ok=False, error=str(e), stage="syntax")

        if not expressions:
            return ValidationResult(
                ok=False, error="Could not parse any SQL statements", stage="syntax"
            )

        # Stage 3: Safety check - reject multiple statements and DML/disallowed operations
        if len(expressions) > 1:
            return ValidationResult(
                ok=False,
                error="Query contains multiple statements. Only a single SELECT query is allowed.",
                stage="safety",
            )

        expression = expressions[0]
        if not expression:
            return ValidationResult(ok=False, error="Parsed expression is empty", stage="syntax")

        # Check statement root type - must be SELECT.
        # Note: Union, CTE (which has Select inside) etc. are allowed.
        # DML node types must be rejected.
        disallowed_types = (
            exp.Insert,
            exp.Update,
            exp.Delete,
            exp.Drop,
            exp.Create,
            exp.Command,
            exp.Alter,
        )

        # Traverse entire AST to find any DML or disallowed nodes
        for node in expression.walk():
            if isinstance(node, disallowed_types):
                node_type = type(node).__name__
                return ValidationResult(
                    ok=False,
                    error=f"Query contains disallowed statement type or clause: {node_type}",
                    stage="safety",
                )

            # Additional safety checks for dangerous keywords in Command or elsewhere
            if isinstance(node, exp.Command):
                cmd_text = node.sql().upper()
                if any(k in cmd_text for k in ["ATTACH", "DETACH", "PRAGMA", "COPY"]):
                    return ValidationResult(
                        ok=False, error="Query contains disallowed database command", stage="safety"
                    )

        # Ensure the root expression is query-like (Select, Union, etc.)
        # sqlglot expression types: Select, Union, CTE (which wraps Select/Union)
        # We can also check if the sql representation has SELECT or WITH at the start
        if not isinstance(expression, (exp.Select, exp.Union, exp.Subquery, exp.CTE)):
            # Wait, a CTE at root level is parsed as a CTE or a Select with CTEs
            # If the expression is not query-like, reject
            return ValidationResult(
                ok=False,
                error=f"Query is not a SELECT statement (type: {type(expression).__name__})",
                stage="safety",
            )

        # Stage 2: Structural validation
        schema_tables = {t.name.lower(): t for t in schema_context.tables}

        # Extract CTE names so we don't treat them as DB tables
        cte_names: set[str] = set()
        for cte in expression.find_all(exp.CTE):
            cte_names.add(cte.alias.lower())

        # Extract all Table references
        referenced_tables = expression.find_all(exp.Table)
        db_tables_found: set[str] = set()

        for table_node in referenced_tables:
            table_name = table_node.name.lower()
            if table_name in cte_names:
                continue  # Skip CTEs

            if table_name not in schema_tables:
                # Table not found, suggest closest
                close_matches = difflib.get_close_matches(
                    table_name, list(schema_tables.keys()), n=1
                )
                suggestion = f". Did you mean '{close_matches[0]}'?" if close_matches else ""
                return ValidationResult(
                    ok=False,
                    error=f"Table '{table_node.name}' does not exist in schema{suggestion}",
                    stage="structural",
                )
            db_tables_found.add(table_name)

        # Extract all Column references
        # Set of all valid column names from the referenced database tables
        valid_db_columns: set[str] = set()
        for table_name in db_tables_found:
            for col in schema_tables[table_name].columns:
                valid_db_columns.add(col.name.lower())

        # Extract all defined aliases in the query (e.g., column aliases in SELECT or subqueries)
        defined_aliases: set[str] = set()
        for alias_node in expression.find_all(exp.Alias):
            defined_aliases.add(alias_node.alias.lower())

        # Check all column nodes in the AST
        for col_node in expression.find_all(exp.Column):
            col_name = col_node.name.lower()

            # Skip special sqlglot column names or empty ones
            if not col_name or col_name in ("*", ""):
                continue

            # Valid if it matches DB columns, aliases, or CTE names.
            if col_name in valid_db_columns or col_name in defined_aliases or col_name in cte_names:
                continue

            # Check if column is prefixed with table alias/name
            # e.g., in o.customer_id, the column node text matches customer_id
            # Let's check if the column name exists in any table in the database
            # If it doesn't, suggest closest matches from the database columns
            all_db_columns = {
                c.name.lower(): c.name for t in schema_context.tables for c in t.columns
            }
            close_matches = difflib.get_close_matches(col_name, list(all_db_columns.keys()), n=1)
            suggestion = (
                f". Did you mean '{all_db_columns[close_matches[0]]}'?" if close_matches else ""
            )
            return ValidationResult(
                ok=False,
                error=f"Column '{col_node.name}' does not exist in referenced tables{suggestion}",
                stage="structural",
            )

        return ValidationResult(ok=True)


def validate_sql(sql: str, schema_context: SchemaContext) -> ValidationResult:
    return SqlValidator().validate(sql, schema_context)
