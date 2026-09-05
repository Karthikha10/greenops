from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ServerTelemetryIn(BaseModel):
    server_id: str
    cpu_utilization: float = Field(ge=0, le=100)
    memory_utilization: float = Field(ge=0, le=100)
    network_throughput_gbps: float = Field(ge=0)
    workload_intensity: float = Field(ge=0, le=1)


class PowerTelemetryIn(BaseModel):
    server_id: str
    it_power_kw: float = Field(ge=0)
    facility_power_kw: float = Field(ge=0)


class CoolingTelemetryIn(BaseModel):
    server_id: str
    inlet_temperature_c: float
    cooling_efficiency: float = Field(ge=0, le=1)
    cooling_type: str = "Air"


class StorageTelemetryIn(BaseModel):
    server_id: str
    total_storage_gb: float = Field(gt=0)
    used_storage_gb: float = Field(ge=0)
    duplicate_data_gb: float = Field(ge=0)
    last_accessed_days_ago: int = Field(ge=0)
    storage_type: str = "SSD"


class ServerRegisterIn(BaseModel):
    server_id: str
    server_type: str = "Compute"
    cooling_type: str = "Air"
    datacenter_region: str = "APAC"

class OperatorActionIn(BaseModel):
    action: str
    notes: Optional[str] = None
    snooze_hours: Optional[float] = Field(default=24, gt=0, le=24 * 30)


class PreferencesIn(BaseModel):
    energy_weight: float = Field(ge=0, le=10)
    cost_weight: float = Field(ge=0, le=10)
    carbon_weight: float = Field(ge=0, le=10)
    water_weight: float = Field(ge=0, le=10)
    risk_weight: float = Field(ge=0, le=10)