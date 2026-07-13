"""The app — and the reason gtl-contract imports rather than parses.

`UpdateTierRequest` writes `organizations.tier`. It is a real client write surface.
But it is not called `OrganizationCreate` or `OrganizationUpdate`, so a scan that
finds write schemas BY NAME reports `organizations` as having no client write
surface and moves on — a miss that is invisible to itself.

The route table is authoritative: if FastAPI parses it as a request body, a client
can send it, whatever it happens to be called. You cannot get that by reading files.

-> contract/unregistered-write-surface
"""

from fastapi import FastAPI
from pydantic import BaseModel

from .schemas.deal import DealCreate, DealResponse

app = FastAPI()


class UpdateTierRequest(BaseModel):
    """Writes organizations.tier. Follows no naming convention. Covered by nothing."""

    tier: str


class BRRRRCalculatorRequest(BaseModel):
    """Writes no table at all — a pure calculator input.

    The legitimate case for the allowlist: it IS an unaudited request body, and it
    always will be, because there is nothing to audit. Pinning it is the honest
    answer, and the pin is what lets a genuinely new body stand out.
    """

    purchase_price: float
    rehab_cost: float


@app.post("/deals", response_model=DealResponse)
def create_deal(body: DealCreate):  # conventional: covered by the Deal contract
    return body


@app.post("/orgs/{org_id}/tier")
def update_tier(org_id: str, body: UpdateTierRequest):  # NOT covered by anything
    return {"ok": True}


@app.post("/calculators/brrrr")
def calc(body: BRRRRCalculatorRequest):
    return {"ok": True}
