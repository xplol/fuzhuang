#!/usr/bin/env python3
import json
import re
import sqlite3
import sys
import traceback
import xml.etree.ElementTree as ET
from io import BytesIO
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlparse
from zipfile import ZipFile


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "jiangsu_fuzhuang.sqlite3"
HOST = "127.0.0.1"
PORT = 8301


def now_text():
    return datetime.now().strftime("%Y/%-m/%-d %H:%M:%S")


def now_iso_text():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_iso():
    return datetime.now().strftime("%Y-%m-%d")


def dict_factory(cursor, row):
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


def connect():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = dict_factory
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS materials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                spec TEXT NOT NULL,
                size TEXT NOT NULL,
                color TEXT NOT NULL,
                stock INTEGER NOT NULL DEFAULT 0,
                threshold INTEGER NOT NULL DEFAULT 50,
                price REAL NOT NULL DEFAULT 0,
                cost REAL NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS inbound_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                material_id INTEGER NOT NULL,
                material_name TEXT NOT NULL,
                spec TEXT NOT NULL,
                size TEXT NOT NULL,
                color TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                operator TEXT NOT NULL,
                remark TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(material_id) REFERENCES materials(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS outbound_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                material_id INTEGER NOT NULL,
                material_name TEXT NOT NULL,
                spec TEXT NOT NULL,
                size TEXT NOT NULL,
                color TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                sale_amount REAL NOT NULL,
                total_amount REAL NOT NULL,
                applicant TEXT NOT NULL,
                salesperson TEXT NOT NULL,
                commission REAL NOT NULL,
                buyer TEXT NOT NULL,
                remark TEXT,
                status TEXT NOT NULL DEFAULT '待审核',
                created_at TEXT NOT NULL,
                reviewed_at TEXT,
                FOREIGN KEY(material_id) REFERENCES materials(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS outbound_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id INTEGER,
                material_id INTEGER NOT NULL,
                material_name TEXT NOT NULL,
                spec TEXT NOT NULL,
                size TEXT NOT NULL,
                color TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                operator TEXT NOT NULL,
                status TEXT NOT NULL,
                remark TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(material_id) REFERENCES materials(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sales_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id INTEGER,
                sale_date TEXT NOT NULL,
                buyer TEXT NOT NULL,
                material_name TEXT NOT NULL,
                spec_size_color TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                sale_amount REAL NOT NULL,
                cost_amount REAL NOT NULL,
                salesperson TEXT NOT NULL,
                commission REAL NOT NULL,
                profit REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL,
                permissions TEXT NOT NULL,
                last_login TEXT
            );

            CREATE TABLE IF NOT EXISTS role_permissions (
                role TEXT PRIMARY KEY,
                permissions TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS outbound_request_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id INTEGER NOT NULL,
                material_id INTEGER NOT NULL,
                material_name TEXT NOT NULL,
                spec TEXT NOT NULL,
                size TEXT NOT NULL,
                color TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                sale_amount REAL NOT NULL,
                cost_amount REAL NOT NULL,
                profit REAL NOT NULL,
                FOREIGN KEY(request_id) REFERENCES outbound_requests(id) ON DELETE CASCADE,
                FOREIGN KEY(material_id) REFERENCES materials(id) ON DELETE CASCADE
            );
            """
        )
        ensure_column(conn, "outbound_requests", "reject_reason", "TEXT")
        ensure_column(conn, "outbound_records", "buyer", "TEXT")
        ensure_system_settings(conn)
        demo_seed_allowed = get_setting(conn, "database_cleared") != "1"

        if demo_seed_allowed and conn.execute("SELECT COUNT(*) AS total FROM materials").fetchone()["total"] == 0:
            seed_materials = [
                ("纯棉T恤", "纯棉", "M", "白色", 120, 50, 89, 35),
                ("雪纺连衣裙", "雪纺", "L", "粉色", 45, 50, 199, 78),
                ("牛仔外套", "牛仔布", "XL", "深蓝", 30, 50, 299, 120),
                ("休闲西裤", "涤纶混纺", "32", "黑色", 80, 50, 159, 55),
                ("真丝衬衫", "真丝", "S", "米白", 15, 50, 399, 160),
            ]
            for row in seed_materials:
                conn.execute(
                    """
                    INSERT INTO materials (name, spec, size, color, stock, threshold, price, cost, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (*row, now_text(), now_text()),
                )

        if demo_seed_allowed and conn.execute("SELECT COUNT(*) AS total FROM inbound_records").fetchone()["total"] == 0:
            seed_inbound(conn)

        if demo_seed_allowed and conn.execute("SELECT COUNT(*) AS total FROM outbound_records").fetchone()["total"] == 0:
            seed_outbound(conn)

        if demo_seed_allowed and conn.execute("SELECT COUNT(*) AS total FROM sales_records").fetchone()["total"] == 0:
            seed_sales(conn)

        if conn.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"] == 0:
            seed_users(conn)
        seed_role_permissions(conn)

        backfill_outbound_items(conn)


def ensure_column(conn, table, column, definition):
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def get_setting(conn, key, default=""):
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, str(value), now_text()),
    )


def ensure_system_settings(conn):
    if not conn.execute("SELECT 1 FROM app_settings WHERE key = 'secondary_password'").fetchone():
        set_setting(conn, "secondary_password", "123456")
    if not conn.execute("SELECT 1 FROM app_settings WHERE key = 'database_cleared'").fetchone():
        set_setting(conn, "database_cleared", "0")


def backfill_outbound_items(conn):
    rows = conn.execute(
        """
        SELECT r.* FROM outbound_requests r
        LEFT JOIN outbound_request_items i ON i.request_id = r.id
        WHERE i.id IS NULL
        """
    ).fetchall()
    for row in rows:
        material = conn.execute("SELECT * FROM materials WHERE id = ?", (row["material_id"],)).fetchone()
        cost_amount = (material["cost"] if material else 0) * row["quantity"]
        profit = row["total_amount"] - cost_amount - row["commission"]
        conn.execute(
            """
            INSERT INTO outbound_request_items
            (request_id, material_id, material_name, spec, size, color, quantity, sale_amount, cost_amount, profit)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["id"],
                row["material_id"],
                row["material_name"],
                row["spec"],
                row["size"],
                row["color"],
                row["quantity"],
                row["total_amount"],
                cost_amount,
                profit,
            ),
        )


def get_material(conn, material_id):
    row = conn.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    if not row:
        raise ApiError(404, "物资不存在")
    return row


def seed_inbound(conn):
    rows = [
        (1, "纯棉T恤", "纯棉", "M", "-", 200, "张三", "首批采购入库"),
        (2, "雪纺连衣裙", "雪纺", "L", "-", 100, "李四", "夏季新品到货"),
        (3, "牛仔外套", "牛仔布", "XL", "-", 50, "张三", "补货入库"),
        (4, "休闲西裤", "涤纶混纺", "32", "-", 150, "王五", "供应商直发"),
    ]
    for row in rows:
        conn.execute(
            """
            INSERT INTO inbound_records (material_id, material_name, spec, size, color, quantity, operator, remark, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (*row, "2026/7/4 02:19:41"),
        )


def seed_outbound(conn):
    rows = [
        (1, 1, "纯棉T恤", "纯棉", "M", "-", 20, "赵六", "已通过", "-"),
        (2, 2, "雪纺连衣裙", "雪纺", "L", "-", 10, "赵六", "已通过", "-"),
        (3, 3, "牛仔外套", "牛仔布", "XL", "-", 5, "李四", "待审核", "-"),
        (4, 5, "真丝衬衫", "真丝", "S", "-", 3, "赵六", "已驳回", "-"),
    ]
    for row in rows:
        conn.execute(
            """
            INSERT INTO outbound_records (request_id, material_id, material_name, spec, size, color, quantity, operator, status, remark, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (*row, "2026/7/4 02:19:41"),
        )


def seed_sales(conn):
    rows = [
        ("2026-07-03", "某某公司", "女士连衣裙", "标准款 / M / 红色", 50, 9950, 4000, "张三", 595, 5355),
        ("2026-07-02", "某某商场", "男士衬衫", "商务款 / L / 白色", 80, 12720, 5200, "李四", 752, 6768),
        ("2026-07-01", "个人客户", "男士 T 恤", "休闲款 / XL / 黑色", 100, 5900, 2500, "王五", 340, 3060),
        ("2026-06-28", "某某专卖店", "休闲裤", "修身款 / 32 / 深蓝", 60, 7740, 3300, "张三", 444, 3996),
        ("2026-06-25", "电商平台", "运动外套", "防风款 / L / 灰色", 40, 11960, 4800, "李四", 716, 6444),
        ("2026-06-20", "某某门店", "儿童卫衣", "加绒款 / 130 / 粉色", 80, 7120, 2800, "赵六", 432, 3888),
        ("2026-06-15", "批发商 A", "牛仔裤", "直筒款 / 34 / 蓝色", 50, 8950, 3500, "王五", 545, 4905),
        ("2026-06-10", "某某百货", "羽绒服", "轻薄款 / M / 黑色", 20, 11980, 5000, "张三", 698, 6282),
    ]
    for row in rows:
        conn.execute(
            """
            INSERT INTO sales_records (sale_date, buyer, material_name, spec_size_color, quantity, sale_amount, cost_amount, salesperson, commission, profit)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            row,
        )


def seed_users(conn):
    users = [
        ("admin", "管理员", "123456", "管理员", "全部权限"),
        ("warehouse", "仓库管理员", "123456", "仓库管理员", "入库、出库、库存查看及出库审核"),
        ("staff", "普通员工", "123456", "普通员工", "仅查看权限"),
    ]
    for row in users:
        conn.execute(
            "INSERT INTO users (username, name, password, role, permissions, last_login) VALUES (?, ?, ?, ?, ?, ?)",
            (*row, None),
        )


DEFAULT_ROLE_PERMISSIONS = {
    "管理员": [
        "物资管理-查看", "物资管理-编辑", "入库管理-创建", "入库记录-查看",
        "出库管理-申请", "出库管理-审核", "出库管理-物资信息", "出库管理-销售员",
        "出库管理-提成", "出库记录-查看", "库存统计-查看",
        "库存统计-单价", "库存统计-总价值", "库存统计-成本", "库存统计-成本合计",
        "销售记录-查看", "销售记录-购买方", "销售记录-销售金额", "销售记录-成本",
        "销售记录-提成", "销售记录-利润", "权限管理-配置",
    ],
    "仓库管理员": [
        "物资管理-查看", "物资管理-编辑", "入库管理-创建", "入库记录-查看",
        "出库管理-申请", "出库管理-审核", "出库记录-查看", "库存统计-查看",
    ],
    "普通员工": ["物资管理-查看", "库存统计-查看"],
}


def permission_text(conn, role):
    row = conn.execute("SELECT permissions FROM role_permissions WHERE role = ?", (role,)).fetchone()
    if row:
        return row["permissions"]
    return "、".join(DEFAULT_ROLE_PERMISSIONS.get(role, [])) or "仅查看权限"


def seed_role_permissions(conn):
    for role, permissions in DEFAULT_ROLE_PERMISSIONS.items():
        row = conn.execute("SELECT permissions FROM role_permissions WHERE role = ?", (role,)).fetchone()
        if not row:
            conn.execute(
                "INSERT INTO role_permissions (role, permissions, updated_at) VALUES (?, ?, ?)",
                (role, "、".join(permissions), now_text()),
            )
            continue
        if role == "管理员":
            existing = [item for item in row["permissions"].split("、") if item]
            merged = existing[:]
            for item in permissions:
                if item not in merged:
                    merged.append(item)
            if merged != existing:
                text = "、".join(merged)
                conn.execute("UPDATE role_permissions SET permissions = ?, updated_at = ? WHERE role = ?", (text, now_text(), role))
                conn.execute("UPDATE users SET permissions = ? WHERE role = ?", (text, role))


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def required(data, *names):
    for name in names:
        if data.get(name) in (None, ""):
            raise ApiError(400, f"{name} 不能为空")


def to_int(value, name):
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ApiError(400, f"{name} 必须是整数")
    return number


def to_float(value, name):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ApiError(400, f"{name} 必须是数字")
    return number


def money(value):
    return f"¥{float(value):,.2f}"


def material_json(row):
    status = "充足" if row["stock"] >= row["threshold"] else "库存不足"
    return {
        **row,
        "status": status,
        "price_text": money(row["price"]),
        "cost_text": money(row["cost"]),
        "total_value": row["stock"] * row["price"],
        "total_value_text": money(row["stock"] * row["price"]),
        "total_cost": row["stock"] * row["cost"],
        "total_cost_text": money(row["stock"] * row["cost"]),
        "stock_text": f"{row['stock']}(预警)" if row["stock"] < row["threshold"] else str(row["stock"]),
    }


def list_materials(conn, params):
    keyword = first(params, "search")
    category = first(params, "category")
    spec = first(params, "spec")
    color = first(params, "color")
    size = first(params, "size")
    sql = "SELECT * FROM materials WHERE 1=1"
    args = []
    if keyword:
        sql += " AND name LIKE ?"
        args.append(f"%{keyword}%")
    if category and category != "全部品类":
        sql += " AND (name = ? OR REPLACE(name, ' ', '') LIKE ?)"
        args += [category, f"%{category.replace(' ', '')}%"]
    if spec and spec != "全部规格":
        sql += " AND spec = ?"
        args.append(spec)
    if color and color != "全部颜色":
        sql += " AND color = ?"
        args.append(color)
    if size and size not in ("全部尺码", "全部尺寸"):
        sql += " AND size = ?"
        args.append(size)
    sql += " ORDER BY id ASC"
    return [material_json(row) for row in conn.execute(sql, args).fetchall()]


def first(params, name, default=""):
    value = params.get(name, [default])
    return value[0] if value else default


def dashboard(conn):
    today = datetime.now().strftime("%Y/%-m/%-d")
    today_in = conn.execute(
        "SELECT COALESCE(SUM(quantity), 0) AS total FROM inbound_records WHERE created_at LIKE ?",
        (f"{today}%",),
    ).fetchone()["total"]
    today_in_batches = conn.execute(
        "SELECT COUNT(*) AS total FROM inbound_records WHERE created_at LIKE ?",
        (f"{today}%",),
    ).fetchone()["total"]
    today_out = conn.execute(
        "SELECT COALESCE(SUM(quantity), 0) AS total FROM outbound_records WHERE status = '已通过' AND created_at LIKE ?",
        (f"{today}%",),
    ).fetchone()["total"]
    stock = conn.execute("SELECT COALESCE(SUM(stock), 0) AS total FROM materials").fetchone()["total"]
    low = conn.execute("SELECT COUNT(*) AS total FROM materials WHERE stock < threshold").fetchone()["total"]
    pending_outbound = conn.execute("SELECT COUNT(*) AS total FROM outbound_requests WHERE status = '待审核'").fetchone()["total"]
    recent_in = conn.execute(
        "SELECT '入库' AS type, material_name, quantity, created_at FROM inbound_records ORDER BY id DESC LIMIT 4"
    ).fetchall()
    recent_out = conn.execute(
        "SELECT '出库' AS type, material_name, quantity, created_at FROM outbound_records ORDER BY id DESC LIMIT 1"
    ).fetchall()
    warnings = [material_json(row) for row in conn.execute("SELECT * FROM materials WHERE stock < threshold ORDER BY stock ASC").fetchall()]
    return {
        "stats": {
            "today_inbound": today_in,
            "today_inbound_batches": today_in_batches,
            "today_outbound": today_out,
            "current_stock": stock,
            "low_stock": low,
            "pending_outbound": pending_outbound,
        },
        "recent": recent_in + recent_out,
        "warnings": warnings,
        "notifications": {
            "low_stock": {
                "title": "低库存预警",
                "description": "提醒部分物资库存低于预警阈值",
                "count": low,
            },
            "inbound_success": {
                "title": "入库成功",
                "description": "显示今日已完成的入库批次",
                "count": today_in_batches,
            },
            "pending_outbound": {
                "title": "出库申请待审核",
                "description": "提醒有待审核的出库申请",
                "count": pending_outbound,
            },
        },
    }


def rows_query(conn, table, params, extra_fields="*"):
    keyword = first(params, "search")
    start = first(params, "start")
    end = first(params, "end")
    status = first(params, "status")
    category = first(params, "category")
    spec = first(params, "spec")
    color = first(params, "color")
    size = first(params, "size")
    salesperson = first(params, "salesperson")
    year = first(params, "year")
    month = first(params, "month")
    month_num = first(params, "month_num")
    date_field = "sale_date" if table == "sales_records" else "created_at"
    sql = f"SELECT {extra_fields} FROM {table} WHERE 1=1"
    args = []
    if keyword:
        if table == "sales_records":
            sql += " AND (material_name LIKE ? OR buyer LIKE ?)"
            args += [f"%{keyword}%", f"%{keyword}%"]
        elif table == "outbound_records":
            sql += " AND (material_name LIKE ? OR COALESCE(buyer, '') LIKE ?)"
            args += [f"%{keyword}%", f"%{keyword}%"]
        else:
            sql += " AND material_name LIKE ?"
            args.append(f"%{keyword}%")
    if category and category != "全部品类":
        sql += " AND material_name = ?"
        args.append(category)
    if spec and spec != "全部规格":
        if table == "sales_records":
            sql += " AND spec_size_color LIKE ?"
            args.append(f"{spec} /%")
        else:
            sql += " AND spec = ?"
            args.append(spec)
    if color and color != "全部颜色":
        if table == "sales_records":
            sql += " AND spec_size_color LIKE ?"
            args.append(f"%/ {color}")
        else:
            sql += " AND color = ?"
            args.append(color)
    if size and size not in ("全部尺码", "全部尺寸"):
        if table == "sales_records":
            sql += " AND spec_size_color LIKE ?"
            args.append(f"%/ {size} /%")
        else:
            sql += " AND size = ?"
            args.append(size)
    if salesperson and salesperson != "全部销售员":
        sql += " AND salesperson = ?"
        args.append(salesperson)
    if status and status != "全部状态":
        sql += " AND status = ?"
        args.append(status)
    sql += " ORDER BY id DESC"
    rows = conn.execute(sql, args).fetchall()
    if year and year != "全部年份":
        rows = [row for row in rows if date_key(row.get(date_field, "")).startswith(year)]
    if month_num and month_num != "全部月份":
        month_text = f"{int(month_num):02d}" if str(month_num).isdigit() else str(month_num).zfill(2)
        rows = [row for row in rows if date_key(row.get(date_field, ""))[5:7] == month_text]
    if month and month != "全部月份":
        rows = [row for row in rows if date_key(row.get(date_field, "")).startswith(month)]
    if start:
        rows = [row for row in rows if date_key(row.get(date_field, "")) >= start]
    if end:
        rows = [row for row in rows if date_key(row.get(date_field, "")) <= end]
    return rows


def date_key(value):
    match = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", str(value or ""))
    if not match:
        return ""
    year, month, day = match.groups()
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def create_material(conn, data):
    required(data, "name", "spec", "size", "color", "stock", "threshold", "price", "cost")
    stock = to_int(data["stock"], "当前库存")
    threshold = to_int(data["threshold"], "预警阈值")
    price = to_float(data["price"], "单价")
    cost = to_float(data["cost"], "成本")
    if stock < 0 or threshold < 0 or price < 0 or cost < 0:
        raise ApiError(400, "数值不能小于 0")
    cursor = conn.execute(
        """
        INSERT INTO materials (name, spec, size, color, stock, threshold, price, cost, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data["name"].strip(),
            data["spec"].strip(),
            data["size"].strip(),
            data["color"].strip(),
            stock,
            threshold,
            price,
            cost,
            now_text(),
            now_text(),
        ),
    )
    return material_json(get_material(conn, cursor.lastrowid))


def update_material(conn, material_id, data):
    row = get_material(conn, material_id)
    merged = {**row, **data}
    required(merged, "name", "spec", "size", "color", "stock", "threshold", "price", "cost")
    stock = to_int(merged["stock"], "当前库存")
    threshold = to_int(merged["threshold"], "预警阈值")
    price = to_float(merged["price"], "单价")
    cost = to_float(merged["cost"], "成本")
    if stock < 0 or threshold < 0 or price < 0 or cost < 0:
        raise ApiError(400, "数值不能小于 0")
    conn.execute(
        """
        UPDATE materials
        SET name = ?, spec = ?, size = ?, color = ?, stock = ?, threshold = ?, price = ?, cost = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            merged["name"].strip(),
            merged["spec"].strip(),
            merged["size"].strip(),
            merged["color"].strip(),
            stock,
            threshold,
            price,
            cost,
            now_text(),
            material_id,
        ),
    )
    return material_json(get_material(conn, material_id))


def delete_material(conn, material_id):
    row = get_material(conn, material_id)
    conn.execute("DELETE FROM materials WHERE id = ?", (material_id,))
    return {"deleted": True, "material": row}


def create_inbound(conn, data):
    operator = data.get("operator") or "游客"
    remark = data.get("remark") or ""
    raw_items = data.get("items")
    if not raw_items:
        required(data, "material_id", "quantity")
        raw_items = [{"material_id": data["material_id"], "quantity": data["quantity"]}]
    if not isinstance(raw_items, list) or not raw_items:
        raise ApiError(400, "请至少添加一个入库物资")
    created = []
    for index, raw in enumerate(raw_items, start=1):
        material_id = to_int(raw.get("material_id"), f"第 {index} 行物资")
        quantity = to_int(raw.get("quantity"), f"第 {index} 行入库数量")
        if quantity <= 0:
            raise ApiError(400, f"第 {index} 行入库数量必须大于 0")
        material = get_material(conn, material_id)
        conn.execute("UPDATE materials SET stock = stock + ?, updated_at = ? WHERE id = ?", (quantity, now_text(), material_id))
        cursor = conn.execute(
            """
            INSERT INTO inbound_records (material_id, material_name, spec, size, color, quantity, operator, remark, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (material_id, material["name"], material["spec"], material["size"], material["color"], quantity, operator, remark, now_text()),
        )
        created.append(conn.execute("SELECT * FROM inbound_records WHERE id = ?", (cursor.lastrowid,)).fetchone())
    return {"count": len(created), "rows": created}


def cell_ref_col(ref):
    letters = "".join(ch for ch in ref if ch.isalpha())
    number = 0
    for ch in letters:
        number = number * 26 + ord(ch.upper()) - ord("A") + 1
    return number - 1


def parse_xlsx_rows(content):
    ns = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with ZipFile(BytesIO(content)) as zf:
        names = set(zf.namelist())
        if "xl/worksheets/sheet1.xml" not in names:
            raise ApiError(400, "Excel 模板缺少第一个工作表")
        shared = []
        if "xl/sharedStrings.xml" in names:
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for item in root.findall("a:si", ns):
                shared.append("".join((node.text or "") for node in item.findall(".//a:t", ns)))
        root = ET.fromstring(zf.read("xl/worksheets/sheet1.xml"))
        rows = []
        for row in root.findall("a:sheetData/a:row", ns):
            values = []
            for cell in row.findall("a:c", ns):
                col = cell_ref_col(cell.attrib.get("r", "A1"))
                while len(values) <= col:
                    values.append("")
                value_node = cell.find("a:v", ns)
                if cell.attrib.get("t") == "inlineStr":
                    value = "".join((node.text or "") for node in cell.findall(".//a:t", ns))
                elif value_node is None:
                    value = ""
                else:
                    raw = value_node.text or ""
                    value = shared[int(raw)] if cell.attrib.get("t") == "s" and raw else raw
                values[col] = str(value).strip()
            rows.append(values)
        return rows


def find_or_create_material(conn, name, spec, size, color, price=None, cost=None, threshold=None):
    row = conn.execute(
        """
        SELECT * FROM materials
        WHERE name = ? AND spec = ? AND size = ? AND color = ?
        """,
        (name, spec, size, color),
    ).fetchone()
    if row:
        return row, False
    cursor = conn.execute(
        """
        INSERT INTO materials (name, spec, size, color, stock, threshold, price, cost, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
        """,
        (name, spec, size, color, threshold if threshold is not None else 50, price if price is not None else 0, cost if cost is not None else 0, now_text(), now_text()),
    )
    return get_material(conn, cursor.lastrowid), True


def parse_inbound_import_items(conn, content):
    try:
        rows = parse_xlsx_rows(content)
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(400, f"Excel 文件解析失败：{exc}")
    if not rows:
        raise ApiError(400, "Excel 文件为空")
    headers = [str(value).strip() for value in rows[0]]
    required_headers = ["品名", "规格", "尺寸", "颜色", "数量"]
    header_aliases = {"尺寸": ["尺寸", "尺码"], "数量": ["数量", "入库数量"], "单价": ["单价", "售价"], "成本": ["成本", "成本价"], "预警阈值": ["预警阈值", "库存预警", "预警值"]}
    missing = [name for name in required_headers if not any(alias in headers for alias in header_aliases.get(name, [name]))]
    if missing:
        raise ApiError(400, "模板列缺失：" + "、".join(missing))
    index = {}
    for name in required_headers:
        aliases = header_aliases.get(name, [name])
        index[name] = next(headers.index(alias) for alias in aliases if alias in headers)
    optional_index = {}
    for name in ["单价", "成本", "预警阈值"]:
        aliases = header_aliases[name]
        optional_index[name] = next((headers.index(alias) for alias in aliases if alias in headers), None)
    items = []
    errors = []
    for row_number, row in enumerate(rows[1:], start=2):
        def value(name):
            pos = index[name]
            return row[pos].strip() if pos < len(row) else ""
        def optional_number(name, row_label):
            pos = optional_index.get(name)
            if pos is None or pos >= len(row) or not row[pos].strip():
                return None
            try:
                number = float(row[pos].strip())
            except ValueError:
                errors.append(f"第 {row_number} 行{row_label}不是数字")
                return None
            if number < 0:
                errors.append(f"第 {row_number} 行{row_label}不能小于 0")
                return None
            return int(number) if name == "预警阈值" else number
        if not any(cell.strip() for cell in row):
            continue
        name, spec, size, color, quantity_text = [value(name) for name in required_headers]
        if not all([name, spec, size, color, quantity_text]):
            errors.append(f"第 {row_number} 行存在空字段")
            continue
        try:
            quantity = int(float(quantity_text))
        except ValueError:
            errors.append(f"第 {row_number} 行数量不是数字")
            continue
        if quantity <= 0:
            errors.append(f"第 {row_number} 行数量必须大于 0")
            continue
        price = optional_number("单价", "单价")
        cost = optional_number("成本", "成本")
        threshold = optional_number("预警阈值", "预警阈值")
        material = conn.execute(
            """
            SELECT * FROM materials
            WHERE name = ? AND spec = ? AND size = ? AND color = ?
            """,
            (name, spec, size, color),
        ).fetchone()
        current_stock = material["stock"] if material else 0
        items.append(
            {
                "row": row_number,
                "name": name,
                "spec": spec,
                "size": size,
                "color": color,
                "quantity": quantity,
                "price": price,
                "cost": cost,
                "threshold": threshold,
                "material_exists": bool(material),
                "current_stock": current_stock,
                "after_stock": current_stock + quantity,
                "action": "增加库存" if material else "新增物资并入库",
            }
        )
    if errors:
        raise ApiError(400, "；".join(errors[:5]))
    if not items:
        raise ApiError(400, "没有可导入的数据")
    return items


def preview_inbound_xlsx(conn, content):
    items = parse_inbound_import_items(conn, content)
    return {
        "total": len(items),
        "created_materials": sum(1 for item in items if not item["material_exists"]),
        "existing_materials": sum(1 for item in items if item["material_exists"]),
        "total_quantity": sum(item["quantity"] for item in items),
        "rows": items,
    }


def import_inbound_xlsx(conn, content, operator):
    items = parse_inbound_import_items(conn, content)
    imported = []
    created_materials = 0
    for item in items:
        material, created = find_or_create_material(conn, item["name"], item["spec"], item["size"], item["color"], item.get("price"), item.get("cost"), item.get("threshold"))
        if created:
            created_materials += 1
        elif any(item.get(name) is not None for name in ("price", "cost", "threshold")):
            conn.execute(
                """
                UPDATE materials
                SET price = COALESCE(?, price), cost = COALESCE(?, cost), threshold = COALESCE(?, threshold), updated_at = ?
                WHERE id = ?
                """,
                (item.get("price"), item.get("cost"), item.get("threshold"), now_text(), material["id"]),
            )
        conn.execute("UPDATE materials SET stock = stock + ?, updated_at = ? WHERE id = ?", (item["quantity"], now_text(), material["id"]))
        cursor = conn.execute(
            """
            INSERT INTO inbound_records (material_id, material_name, spec, size, color, quantity, operator, remark, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                material["id"],
                item["name"],
                item["spec"],
                item["size"],
                item["color"],
                item["quantity"],
                operator or "游客",
                "Excel 导入",
                now_text(),
            ),
        )
        imported.append({"row": item["row"], "record_id": cursor.lastrowid, "name": item["name"], "quantity": item["quantity"], "created_material": created})
    return {"imported": len(imported), "created_materials": created_materials, "rows": imported}


def create_outbound_request(conn, data):
    required(data, "applicant", "buyer")
    applicant = data["applicant"].strip()
    salesperson = (data.get("salesperson") or applicant).strip()
    commission = to_float(data.get("commission") or 0, "提成")
    raw_items = data.get("items")
    if not raw_items:
        required(data, "material_id", "quantity", "sale_amount")
        raw_items = [{"material_id": data["material_id"], "quantity": data["quantity"], "sale_amount": data["sale_amount"]}]
    if not isinstance(raw_items, list) or not raw_items:
        raise ApiError(400, "请至少添加一个出库物资")
    items = []
    requested_by_material = {}
    total_amount = 0
    total_quantity = 0
    for index, raw in enumerate(raw_items, start=1):
        material_id = to_int(raw.get("material_id"), f"第 {index} 行物资")
        quantity = to_int(raw.get("quantity"), f"第 {index} 行出货数量")
        sale_amount = to_float(raw.get("sale_amount"), f"第 {index} 行销售金额")
        if quantity <= 0:
            raise ApiError(400, f"第 {index} 行出货数量必须大于 0")
        if sale_amount < 0:
            raise ApiError(400, f"第 {index} 行销售金额不能小于 0")
        material = get_material(conn, material_id)
        requested_by_material[material_id] = requested_by_material.get(material_id, 0) + quantity
        cost_amount = material["cost"] * quantity
        items.append({"material": material, "quantity": quantity, "sale_amount": sale_amount, "cost_amount": cost_amount})
        total_amount += sale_amount
        total_quantity += quantity
    for material_id, requested_quantity in requested_by_material.items():
        material = get_material(conn, material_id)
        pending_quantity = pending_outbound_quantity(conn, material_id)
        available = material["stock"] - pending_quantity
        if available < requested_quantity:
            raise ApiError(400, f"{material['name']} 可用库存不足：当前库存 {material['stock']} 件，待审核占用 {pending_quantity} 件，可出 {max(available, 0)} 件")
    first_item = items[0]
    first_material = first_item["material"]
    material_name = first_material["name"] if len(items) == 1 else f"{first_material['name']}等{len(items)}项"
    spec = first_material["spec"] if len(items) == 1 else "多规格"
    size = first_material["size"] if len(items) == 1 else "多尺码"
    color = first_material["color"] if len(items) == 1 else "多颜色"
    cursor = conn.execute(
        """
        INSERT INTO outbound_requests
        (material_id, material_name, spec, size, color, quantity, sale_amount, total_amount, applicant, salesperson, commission, buyer, remark, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待审核', ?)
        """,
        (
            first_material["id"],
            material_name,
            spec,
            size,
            color,
            total_quantity,
            total_amount,
            total_amount,
            applicant,
            salesperson,
            commission,
            data["buyer"].strip(),
            data.get("remark") or "",
            now_text(),
        ),
    )
    request_id = cursor.lastrowid
    for item in items:
        material = item["material"]
        ratio = item["sale_amount"] / total_amount if total_amount else 0
        item_commission = commission * ratio
        profit = item["sale_amount"] - item["cost_amount"] - item_commission
        conn.execute(
            """
            INSERT INTO outbound_request_items
            (request_id, material_id, material_name, spec, size, color, quantity, sale_amount, cost_amount, profit)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                request_id,
                material["id"],
                material["name"],
                material["spec"],
                material["size"],
                material["color"],
                item["quantity"],
                item["sale_amount"],
                item["cost_amount"],
                profit,
            ),
        )
    return get_outbound_request(conn, request_id)


def pending_outbound_quantity(conn, material_id):
    row = conn.execute(
        """
        SELECT COALESCE(SUM(i.quantity), 0) AS total
        FROM outbound_request_items i
        JOIN outbound_requests r ON r.id = i.request_id
        WHERE i.material_id = ? AND r.status = '待审核'
        """,
        (material_id,),
    ).fetchone()
    return int(row["total"] or 0)


def outbound_items(conn, request_id):
    return conn.execute("SELECT * FROM outbound_request_items WHERE request_id = ? ORDER BY id ASC", (request_id,)).fetchall()


def get_outbound_request(conn, request_id):
    row = conn.execute("SELECT * FROM outbound_requests WHERE id = ?", (request_id,)).fetchone()
    if row:
        row["items"] = outbound_items(conn, request_id)
    return row


def list_outbound_requests(conn):
    rows = conn.execute("SELECT * FROM outbound_requests ORDER BY id DESC").fetchall()
    for row in rows:
        row["items"] = outbound_items(conn, row["id"])
    return rows


def review_outbound_request(conn, request_id, action, data=None):
    request = conn.execute("SELECT * FROM outbound_requests WHERE id = ?", (request_id,)).fetchone()
    if not request:
        raise ApiError(404, "出库申请不存在")
    if request["status"] != "待审核":
        raise ApiError(400, "该申请已经处理过")
    new_status = "已通过" if action == "approve" else "已驳回"
    items = outbound_items(conn, request_id)
    if not items:
        backfill_outbound_items(conn)
        items = outbound_items(conn, request_id)
    commission = request["commission"]
    if action == "approve" and data and "commission" in data:
        commission = to_float(data.get("commission") or 0, "提成")
        if commission < 0:
            raise ApiError(400, "提成不能小于 0")
        conn.execute("UPDATE outbound_requests SET commission = ? WHERE id = ?", (commission, request_id))
    if action == "approve":
        for item in items:
            material = get_material(conn, item["material_id"])
            if material["stock"] < item["quantity"]:
                raise ApiError(400, f"{item['material_name']} 当前库存不足，无法审核通过")
        for item in items:
            conn.execute("UPDATE materials SET stock = stock - ?, updated_at = ? WHERE id = ?", (item["quantity"], now_text(), item["material_id"]))
            ratio = item["sale_amount"] / request["total_amount"] if request["total_amount"] else 0
            item_commission = commission * ratio
            item_profit = item["sale_amount"] - item["cost_amount"] - item_commission
            conn.execute("UPDATE outbound_request_items SET profit = ? WHERE id = ?", (item_profit, item["id"]))
            conn.execute(
                """
                INSERT INTO sales_records (request_id, sale_date, buyer, material_name, spec_size_color, quantity, sale_amount, cost_amount, salesperson, commission, profit)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    request_id,
                    now_iso_text(),
                    request["buyer"],
                    item["material_name"],
                    f"{item['spec']} / {item['size']} / {item['color']}",
                    item["quantity"],
                    item["sale_amount"],
                    item["cost_amount"],
                request["salesperson"] or "",
                    item_commission,
                    item_profit,
                ),
            )
    reject_reason = (data or {}).get("reject_reason") or ""
    conn.execute("UPDATE outbound_requests SET status = ?, reviewed_at = ?, reject_reason = ? WHERE id = ?", (new_status, now_text(), reject_reason, request_id))
    for item in items:
        conn.execute(
            """
            INSERT INTO outbound_records (request_id, material_id, material_name, spec, size, color, quantity, operator, status, remark, created_at, buyer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                request_id,
                item["material_id"],
                item["material_name"],
                item["spec"],
                item["size"],
                item["color"],
                item["quantity"],
                request["applicant"],
                new_status,
                reject_reason if action == "reject" else (request["remark"] or "-"),
                now_text(),
                request["buyer"],
            ),
        )
    return get_outbound_request(conn, request_id)


def create_user(conn, data):
    required(data, "name", "username", "password", "role")
    role = data["role"]
    if role not in DEFAULT_ROLE_PERMISSIONS:
        raise ApiError(400, "角色不正确")
    permissions = permission_text(conn, role)
    try:
        cursor = conn.execute(
            "INSERT INTO users (username, name, password, role, permissions, last_login) VALUES (?, ?, ?, ?, ?, ?)",
            (data["username"].strip(), data["name"].strip(), data["password"], role, permissions, None),
        )
    except sqlite3.IntegrityError:
        raise ApiError(400, "用户名已存在")
    return conn.execute("SELECT id, username, name, role, permissions, last_login FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()


def update_user(conn, user_id, data):
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise ApiError(404, "用户不存在")
    merged = {**row, **data}
    required(merged, "name", "username", "role")
    role = merged["role"]
    if role not in DEFAULT_ROLE_PERMISSIONS:
        raise ApiError(400, "角色不正确")
    permissions = permission_text(conn, role)
    password = data.get("password") or row["password"]
    try:
        conn.execute(
            """
            UPDATE users
            SET username = ?, name = ?, password = ?, role = ?, permissions = ?
            WHERE id = ?
            """,
            (merged["username"].strip(), merged["name"].strip(), password, role, permissions, user_id),
        )
    except sqlite3.IntegrityError:
        raise ApiError(400, "用户名已存在")
    return conn.execute("SELECT id, username, name, role, permissions, last_login FROM users WHERE id = ?", (user_id,)).fetchone()


def delete_user(conn, user_id):
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise ApiError(404, "用户不存在")
    if row["username"] == "admin":
        raise ApiError(400, "默认管理员不能删除")
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"deleted": True}


def login(conn, data):
    account = data.get("account") or data.get("username") or ""
    password = data.get("password") or ""
    code = data.get("code") or ""
    if not account:
        raise ApiError(400, "账号不能为空")
    row = conn.execute("SELECT * FROM users WHERE username = ? OR ? LIKE '%' || username || '%'", (account, account)).fetchone()
    if not row and re.match(r"^[^@]+@[^@]+$", account):
        row = conn.execute("SELECT * FROM users WHERE username = 'admin'").fetchone()
    if not row:
        raise ApiError(401, "账号不存在")
    if password and password != row["password"]:
        raise ApiError(401, "密码不正确")
    if not password and code and len(str(code)) < 4:
        raise ApiError(401, "验证码不正确")
    last_login = now_text()
    conn.execute("UPDATE users SET last_login = ? WHERE id = ?", (last_login, row["id"]))
    return {
        "id": row["id"],
        "username": row["username"],
        "name": row["name"],
        "role": row["role"],
        "permissions": row["permissions"],
        "last_login": last_login,
    }


def list_users(conn):
    return conn.execute("SELECT id, username, name, role, permissions, last_login FROM users ORDER BY id ASC").fetchall()


def list_role_permissions(conn):
    seed_role_permissions(conn)
    rows = conn.execute("SELECT role, permissions, updated_at FROM role_permissions ORDER BY CASE role WHEN '管理员' THEN 1 WHEN '仓库管理员' THEN 2 ELSE 3 END").fetchall()
    return [{**row, "items": [item for item in row["permissions"].split("、") if item]} for row in rows]


def update_role_permissions(conn, data):
    role = data.get("role")
    items = data.get("items")
    if role not in DEFAULT_ROLE_PERMISSIONS:
        raise ApiError(400, "角色不正确")
    if not isinstance(items, list) or not items:
        raise ApiError(400, "权限项不能为空")
    clean = []
    for item in items:
        text = str(item).strip()
        if text and text not in clean:
            clean.append(text)
    permissions = "、".join(clean)
    conn.execute(
        """
        INSERT INTO role_permissions (role, permissions, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(role) DO UPDATE SET permissions = excluded.permissions, updated_at = excluded.updated_at
        """,
        (role, permissions, now_text()),
    )
    conn.execute("UPDATE users SET permissions = ? WHERE role = ?", (permissions, role))
    return {"role": role, "permissions": permissions, "items": clean}


def verify_secondary_password(conn, password):
    if not str(password or "").strip():
        raise ApiError(400, "请输入二次密码")
    if str(password) != get_setting(conn, "secondary_password", "123456"):
        raise ApiError(401, "二次密码不正确")


def update_secondary_password(conn, data):
    current_password = data.get("current_password") or ""
    new_password = str(data.get("new_password") or "").strip()
    confirm_password = str(data.get("confirm_password") or "").strip()
    verify_secondary_password(conn, current_password)
    if len(new_password) < 4:
        raise ApiError(400, "新二次密码至少 4 位")
    if new_password != confirm_password:
        raise ApiError(400, "两次输入的新二次密码不一致")
    set_setting(conn, "secondary_password", new_password)
    return {"updated": True}


def clear_business_database(conn, data):
    verify_secondary_password(conn, data.get("secondary_password") or "")
    if str(data.get("confirm_text") or "").strip() != "确认清空":
        raise ApiError(400, "请输入确认文字：确认清空")
    tables = [
        "sales_records",
        "outbound_records",
        "outbound_request_items",
        "outbound_requests",
        "inbound_records",
        "materials",
    ]
    counts = {table: conn.execute(f"SELECT COUNT(*) AS total FROM {table}").fetchone()["total"] for table in tables}
    for table in tables:
        conn.execute(f"DELETE FROM {table}")
    placeholders = ",".join("?" for _ in tables)
    conn.execute(f"DELETE FROM sqlite_sequence WHERE name IN ({placeholders})", tables)
    set_setting(conn, "database_cleared", "1")
    return {"cleared": True, "counts": counts}


def sales_summary(rows):
    return {
        "sale_amount": sum(row["sale_amount"] for row in rows),
        "cost_amount": sum(row["cost_amount"] for row in rows),
        "commission": sum(row["commission"] for row in rows),
        "profit": sum(row["profit"] for row in rows),
        "quantity": sum(row["quantity"] for row in rows),
    }


def list_salespeople(conn):
    rows = conn.execute(
        "SELECT DISTINCT salesperson FROM sales_records WHERE COALESCE(salesperson, '') != '' ORDER BY salesperson ASC"
    ).fetchall()
    return [row["salesperson"] for row in rows]


def list_sales_years(conn):
    rows = conn.execute(
        "SELECT sale_date FROM sales_records WHERE COALESCE(sale_date, '') != '' ORDER BY sale_date DESC"
    ).fetchall()
    years = sorted({date_key(row["sale_date"])[:4] for row in rows if date_key(row["sale_date"])}, reverse=True)
    return years


class Handler(BaseHTTPRequestHandler):
    server_version = "JiangsuFuzhuangAPI/1.0"

    def do_OPTIONS(self):
        self.send_response(204)
        self.add_cors()
        self.end_headers()

    def do_GET(self):
        self.handle_request("GET")

    def do_POST(self):
        self.handle_request("POST")

    def do_PUT(self):
        self.handle_request("PUT")

    def do_DELETE(self):
        self.handle_request("DELETE")

    def log_message(self, fmt, *args):
        sys.stdout.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def add_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.add_cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            raise ApiError(400, "JSON 格式不正确")

    def read_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length) if length else b""

    def handle_request(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)
        try:
            with connect() as conn:
                if method in ("POST", "PUT", "DELETE") and self.headers.get("Content-Type", "").split(";")[0] == "application/octet-stream":
                    data = {"_raw": self.read_body()}
                else:
                    data = self.read_json() if method in ("POST", "PUT", "DELETE") else {}
                result = route(conn, method, path, params, data)
            self.send_json(200, {"ok": True, "data": result})
        except ApiError as exc:
            self.send_json(exc.status, {"ok": False, "message": exc.message})
        except Exception as exc:
            traceback.print_exc()
            self.send_json(500, {"ok": False, "message": str(exc)})


def route(conn, method, path, params, data):
    if path == "/api/health" and method == "GET":
        return {"status": "ok", "database": str(DB_PATH), "time": now_text()}
    if path == "/api/dashboard" and method == "GET":
        return dashboard(conn)
    if path == "/api/materials" and method == "GET":
        return list_materials(conn, params)
    if path == "/api/materials" and method == "POST":
        return create_material(conn, data)
    match = re.fullmatch(r"/api/materials/(\d+)", path)
    if match and method == "PUT":
        return update_material(conn, int(match.group(1)), data)
    if match and method == "DELETE":
        return delete_material(conn, int(match.group(1)))
    if path == "/api/inbound" and method == "POST":
        return create_inbound(conn, data)
    if path == "/api/inbound-import-preview" and method == "POST":
        content = data.get("_raw") or b""
        if not content:
            raise ApiError(400, "请上传 Excel 文件")
        return preview_inbound_xlsx(conn, content)
    if path == "/api/inbound-import" and method == "POST":
        content = data.get("_raw") or b""
        if not content:
            raise ApiError(400, "请上传 Excel 文件")
        return import_inbound_xlsx(conn, content, first(params, "operator", "游客"))
    if path == "/api/inbound-records" and method == "GET":
        return rows_query(conn, "inbound_records", params)
    if path == "/api/outbound" and method == "POST":
        return create_outbound_request(conn, data)
    if path == "/api/outbound-requests" and method == "GET":
        return list_outbound_requests(conn)
    match = re.fullmatch(r"/api/outbound-requests/(\d+)/(approve|reject)", path)
    if match and method == "POST":
        return review_outbound_request(conn, int(match.group(1)), match.group(2), data)
    if path == "/api/outbound-records" and method == "GET":
        return rows_query(conn, "outbound_records", params)
    if path == "/api/sales-records" and method == "GET":
        rows = rows_query(conn, "sales_records", params)
        return {"rows": rows, "summary": sales_summary(rows), "salespeople": list_salespeople(conn), "years": list_sales_years(conn)}
    if path == "/api/users" and method == "GET":
        return list_users(conn)
    if path == "/api/users" and method == "POST":
        return create_user(conn, data)
    if path == "/api/role-permissions" and method == "GET":
        return list_role_permissions(conn)
    if path == "/api/role-permissions" and method == "POST":
        return update_role_permissions(conn, data)
    if path == "/api/admin/secondary-password" and method == "PUT":
        return update_secondary_password(conn, data)
    if path == "/api/admin/clear-database" and method == "POST":
        return clear_business_database(conn, data)
    match = re.fullmatch(r"/api/users/(\d+)", path)
    if match and method == "PUT":
        return update_user(conn, int(match.group(1)), data)
    if match and method == "DELETE":
        return delete_user(conn, int(match.group(1)))
    if path == "/api/login" and method == "POST":
        return login(conn, data)
    raise ApiError(404, "接口不存在")


if __name__ == "__main__":
    init_db()
    print(f"江苏服装系统 API running on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
