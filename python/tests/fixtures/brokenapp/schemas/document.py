"""The other half of the duplicate class.

`DocumentResponse` is ALSO defined in schemas/deal.py, with different fields. Nobody
writes this on purpose; it happens because two people each needed a document
response and neither knew the other existed. The consequence is that which shape a
client gets depends on which endpoint it happens to hit — the application is
already lying to somebody.

-> contract/duplicate-schema-class-drifted
"""

from typing import Optional

from pydantic import BaseModel


class DocumentResponse(BaseModel):
    document_id: str
    filename: str
    size_bytes: Optional[int] = None  # <- the drift
    content_type: Optional[str] = None  # <- the drift
