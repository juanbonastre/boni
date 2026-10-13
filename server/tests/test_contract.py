"""`api/schema/` must match the Pydantic models, and `api/examples/` must be what the server really returns for the
test vault. Regenerate after a deliberate change:

    python -m boni.contract --write
    BONI_UPDATE_EXAMPLES=1 pytest tests/test_contract.py
"""

import json
import os

from fastapi.testclient import TestClient

from boni.contract import (
    ActionRequest,
    ActionResult,
    AmountField,
    ChartCatalog,
    ChartData,
    ChartsResponse,
    ChoiceField,
    ErrorResponse,
    MultiChoiceField,
    Option,
    OptionsResponse,
    Screen,
    WidgetsResponse,
    api_dir,
    field_json_schema,
    schema_files,
)

UPDATE = os.environ.get("BONI_UPDATE_EXAMPLES") == "1"


def test_schema_files_up_to_date():
    folder = api_dir() / "schema"
    expected = schema_files()
    actual = {p.name: p.read_text() for p in folder.glob("*.schema.json")} if folder.exists() else {}
    assert actual == expected, "api/schema is stale: run `python -m boni.contract --write`"


def check_example(name: str, data: dict) -> None:
    path = api_dir() / "examples" / name
    text = json.dumps(data, indent=2, ensure_ascii=True) + "\n"
    if UPDATE:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    assert path.exists() and json.loads(path.read_text()) == data, f"api/examples/{name} is stale"


REQUEST = {"action": "expenses.capture", "client_id": "0f8a4c9e-3b5d-4e1a-9c2f-7d6b5a4e3c21",
           "values": {"kind": "gasto", "amount": 12.5, "account": "revolut", "category": "comida/restaurante",
                      "concept": "Menu con Lucia", "merchant": "Bar Pepe", "people": ["lucia-ferri"],
                      "shared": False, "date": "2026-10-12"},
           "created_at": "2026-10-12T18:30:00+02:00"}


PREVIEWS = {
    "chart-preview-split": {"title": "Gasto por grupo", "kind": "stacked_bar",
                            "x": {"field": "date", "granularity": "month"}, "split": {"field": "group"},
                            "period": {"kind": "last_months", "months": 3}},
    "chart-preview-compare": {"title": "Septiembre", "kind": "number", "compare": "previous_period",
                              "period": {"kind": "range", "start": "2026-09-01", "end": "2026-09-30"}},
    "chart-preview-donut": {"title": "Reparto del ano", "kind": "donut", "x": {"field": "category"},
                            "period": {"kind": "this_year"},
                            "filters": [{"field": "category", "op": "not_prefix", "values": ["compras"]}]},
}


def test_examples(client: TestClient):
    pairs = [
        ("home.json", "/api/v1/home", Screen),
        ("screen-capture-expense.json", "/api/v1/screens/capture-expense", Screen),
        ("chart-spending-by-category.json", "/api/v1/charts/spending-by-category/data", ChartData),
        ("chart-spending-by-category-drill.json", "/api/v1/charts/spending-by-category/data?drill=comida", ChartData),
        ("chart-monthly-spending.json", "/api/v1/charts/monthly-spending/data", ChartData),
        ("chart-eating-out.json", "/api/v1/charts/eating-out/data", ChartData),
        ("options-people.json", "/api/v1/options/people?q=e", OptionsResponse),
        ("widgets.json", "/api/v1/widgets", WidgetsResponse),
        ("charts.json", "/api/v1/charts", ChartsResponse),
        ("chart-catalog.json", "/api/v1/charts/catalog", ChartCatalog),
    ]
    for name, url, model in pairs:
        data = client.get(url).json()
        model.model_validate(data)
        check_example(name, data)
    for name, spec in PREVIEWS.items():
        check_example(f"{name}-request.json", {"spec": spec})
        data = client.post("/api/v1/charts/preview", json={"spec": spec}).json()
        ChartData.model_validate(data)
        check_example(f"{name}.json", data)
    ActionRequest.model_validate(REQUEST)
    check_example("action-request.json", REQUEST)
    ok = client.post("/api/v1/actions", json=REQUEST).json()
    ActionResult.model_validate(ok)
    check_example("action-result-ok.json", ok)
    bad = client.post("/api/v1/actions", json=REQUEST | {"client_id": "1f8a4c9e-3b5d-4e1a-9c2f-7d6b5a4e3c22",
                                                         "values": {"amount": "", "category": ""}}).json()
    check_example("action-result-invalid.json", bad)
    err = client.get("/api/v1/home", headers={"Authorization": "Bearer nope"}).json()
    ErrorResponse.model_validate(err)
    check_example("error.json", err)


def test_unknown_component_is_kept_out_by_server_but_ignored_fields_are_fine():
    # Forward compatibility: unknown fields in a known component are ignored.
    s = Screen.model_validate({"id": "x", "title": "X", "components": [
        {"type": "text", "text": "hola", "new_field": 1}]})
    assert s.components[0].text == "hola"


def test_fields_map_to_elicitation_schema():
    assert field_json_schema(AmountField(id="a", label="Importe")) == {"title": "Importe", "type": "number",
                                                                       "minimum": 0.01}
    opts = [Option(value="revolut", label="Revolut")]
    assert field_json_schema(ChoiceField(id="c", label="Cuenta", options=opts))["oneOf"] == [
        {"const": "revolut", "title": "Revolut"}]
    multi = field_json_schema(MultiChoiceField(id="p", label="Con quien", source="people"), options=opts)
    assert multi["type"] == "array" and multi["items"]["anyOf"][0]["const"] == "revolut"
