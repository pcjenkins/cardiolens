# CardioLens data model

Generated from the live `cardiolens` schema by `npm run db:erd`: 40 tables, 44 declared foreign keys,
11 logical ones. Solid lines are declared foreign keys. Dotted lines are relationships the high-volume tables
deliberately don't declare: raw samples and aggregates are written only through `ingest_samples()`, and an FK check per row
costs more than it protects. Rendered copies are in [docs/erd/](erd/).

## Overview

```mermaid
---
title: "CardioLens core: where it is, what recorded it, whose case, the samples (dotted = logical FK)"
---
erDiagram
  health_system
  facility
  location
  room
  device_assignment
  device_model
  device
  device_module
  maintenance_plan
  work_order
  patient
  encounter
  surgical_case
  recording_session
  channel
  raw_sample
  agg_minute
  agg_case_phase
  surgical_case ||--o{ agg_case_phase : "case_id"
  channel ||--o{ agg_case_phase : "channel_id"
  facility ||--o{ device : "facility_id"
  device_model ||--o{ device : "model_id"
  device ||--o{ device_assignment : "device_id"
  room ||--o{ device_assignment : "room_id"
  device ||--o{ device_module : "device_id"
  facility ||--o{ encounter : "facility_id"
  patient ||--o{ encounter : "patient_id"
  health_system ||--o{ facility : "health_system_id"
  facility ||--o{ location : "facility_id"
  location |o--o{ location : "parent_id"
  device_model ||--o{ maintenance_plan : "device_model_id"
  surgical_case ||--o{ recording_session : "case_id"
  device ||--o{ recording_session : "device_id"
  location ||--o{ room : "location_id"
  encounter ||--o{ surgical_case : "encounter_id"
  room ||--o{ surgical_case : "room_id"
  device ||--o{ work_order : "device_id"
  maintenance_plan |o--o{ work_order : "plan_id"
  recording_session ||..o{ raw_sample : "session_id"
  channel ||..o{ raw_sample : "channel_id"
  recording_session ||..o{ agg_minute : "session_id"
  channel ||..o{ agg_minute : "channel_id"
```

## Organization

```mermaid
---
title: "Organization hierarchy: health system > facility > location tree > room"
---
erDiagram
  health_system {
    integer id PK
    text name
  }
  facility {
    integer id PK
    integer health_system_id FK
    text name
    text city
    text state
    text time_zone
  }
  location {
    integer id PK
    integer facility_id FK
    integer parent_id FK
    text kind
    text name
  }
  room {
    integer id PK
    integer location_id FK
    text name
    text kind
  }
  device_assignment {
    integer id PK
    integer device_id FK
    integer room_id FK
    tstzrange during
  }
  device
  surgical_case
  encounter
  facility ||--o{ device : "facility_id"
  device ||--o{ device_assignment : "device_id"
  room ||--o{ device_assignment : "room_id"
  facility ||--o{ encounter : "facility_id"
  health_system ||--o{ facility : "health_system_id"
  facility ||--o{ location : "facility_id"
  location |o--o{ location : "parent_id"
  location ||--o{ room : "location_id"
  room ||--o{ surgical_case : "room_id"
```

## Clinical

```mermaid
---
title: "Clinical: patient > encounter > case, staff, events, labs, products"
---
erDiagram
  patient {
    integer id PK
    text mrn
    text first_name
    text last_name
    date birth_date
    char sex
    numeric height_cm
    numeric weight_kg
    numeric bsa_m2 "generated"
  }
  encounter {
    integer id PK
    integer patient_id FK
    integer facility_id FK
    timestamptz admitted_at
    timestamptz discharged_at
    text outcome
  }
  surgical_case {
    integer id PK
    integer encounter_id FK
    integer room_id FK
    text procedure
    timestamptz scheduled_start
    text source
    jsonb legacy_summary
  }
  case_staff {
    integer case_id PK,FK
    integer staff_id PK,FK
    text role PK
  }
  staff {
    integer id PK
    text name
    text discipline
  }
  case_event {
    bigint id PK
    integer case_id FK
    timestamptz ts
    text event_type
    jsonb detail
  }
  lab_result {
    bigint id PK
    integer case_id FK
    timestamptz ts
    text test
    numeric value
    text unit
  }
  transfusion {
    bigint id PK
    integer case_id FK
    timestamptz ts
    text product
    integer units
  }
  disposable_use {
    integer case_id PK,FK
    integer product_id PK,FK
    text lot PK
    date expires_on
  }
  disposable_product {
    integer id PK
    integer manufacturer_id FK
    text name
    text kind
    text udi_di
  }
  app_user {
    integer id PK
    text email
    text name
    text role
    text password_hash
  }
  room
  facility
  manufacturer
  surgical_case ||--o{ case_event : "case_id"
  surgical_case ||--o{ case_staff : "case_id"
  staff ||--o{ case_staff : "staff_id"
  manufacturer ||--o{ disposable_product : "manufacturer_id"
  surgical_case ||--o{ disposable_use : "case_id"
  disposable_product ||--o{ disposable_use : "product_id"
  facility ||--o{ encounter : "facility_id"
  patient ||--o{ encounter : "patient_id"
  surgical_case ||--o{ lab_result : "case_id"
  encounter ||--o{ surgical_case : "encounter_id"
  room ||--o{ surgical_case : "room_id"
  surgical_case ||--o{ transfusion : "case_id"
```

## Devices

```mermaid
---
title: "Devices and provenance: model > device > modules > channels"
---
erDiagram
  manufacturer {
    integer id PK
    text name
  }
  device_model {
    integer id PK
    integer manufacturer_id FK
    text name
    text device_type
    text udi_di
    text regulatory_class
  }
  module_model {
    integer id PK
    integer manufacturer_id FK
    text name
    text module_type
  }
  device {
    integer id PK
    integer model_id FK
    text serial
    text asset_tag
    integer facility_id FK
    date installed_on
    text status
  }
  device_module {
    integer id PK
    integer device_id FK
    integer module_model_id FK
    text serial
    text firmware
    text position
  }
  software_install {
    integer id PK
    integer device_id FK
    text version
    timestamptz installed_at
    text installed_by
  }
  channel {
    smallint id PK
    text code
    text name
    text unit
    real sample_rate_hz
    text kind
    text formula
    real low_limit
    real high_limit
    smallint decimals
  }
  module_channel {
    integer module_model_id PK,FK
    smallint channel_id PK,FK
  }
  device_assignment
  facility
  recording_session
  facility ||--o{ device : "facility_id"
  device_model ||--o{ device : "model_id"
  device ||--o{ device_assignment : "device_id"
  manufacturer ||--o{ device_model : "manufacturer_id"
  device ||--o{ device_module : "device_id"
  module_model ||--o{ device_module : "module_model_id"
  channel ||--o{ module_channel : "channel_id"
  module_model ||--o{ module_channel : "module_model_id"
  manufacturer ||--o{ module_model : "manufacturer_id"
  device ||--o{ recording_session : "device_id"
  device ||--o{ software_install : "device_id"
```

## Maintenance

```mermaid
---
title: "Maintenance: plans, tasks, work orders"
---
erDiagram
  maintenance_plan {
    integer id PK
    integer device_model_id FK
    text name
    integer interval_days
    integer interval_hours
    integer grace_days
    boolean regulatory
  }
  maintenance_task {
    integer id PK
    integer plan_id FK
    integer seq
    text description
    text spec
  }
  work_order {
    integer id PK
    integer device_id FK
    integer plan_id FK
    text kind
    timestamptz opened_at
    timestamptz completed_at
    integer technician_id FK
    text result
    text notes
  }
  work_order_task {
    integer work_order_id PK,FK
    integer task_id PK,FK
    text measured
    boolean passed
  }
  technician {
    integer id PK
    text name
    text company
    date cert_expires_on
  }
  device
  device_model
  device_model ||--o{ maintenance_plan : "device_model_id"
  maintenance_plan ||--o{ maintenance_task : "plan_id"
  device ||--o{ work_order : "device_id"
  maintenance_plan |o--o{ work_order : "plan_id"
  technician |o--o{ work_order : "technician_id"
  maintenance_task ||--o{ work_order_task : "task_id"
  work_order ||--o{ work_order_task : "work_order_id"
```

## Capture

```mermaid
---
title: "Capture: sessions, raw samples (partitioned by month), alarms, settings, emboli"
---
erDiagram
  recording_session {
    integer id PK
    integer case_id FK
    integer device_id FK
    timestamptz started_at
    timestamptz ended_at
    text software_version
    integer clock_offset_ms
    text gateway
    boolean maintenance_ok
    text maintenance_note
  }
  raw_sample {
    integer session_id PK,FK "logical FK"
    smallint channel_id PK,FK "logical FK"
    timestamptz ts PK
    real value
    smallint quality FK "logical FK"
  }
  sample_quality {
    smallint code PK
    text name
  }
  alarm_event {
    bigint id PK
    integer session_id FK
    smallint channel_id FK
    timestamptz ts
    text limit_kind
    real limit_value
    real value
    timestamptz acked_at
    integer acked_by FK
  }
  setting_change {
    bigint id PK
    integer session_id FK
    timestamptz ts
    text parameter
    real old_value
    real new_value
    integer staff_id FK
  }
  emboli_event {
    integer session_id PK,FK
    timestamptz ts PK
    text line PK
    real est_volume_nl
  }
  surgical_case
  device
  channel
  staff
  staff |o--o{ alarm_event : "acked_by"
  channel ||--o{ alarm_event : "channel_id"
  recording_session ||--o{ alarm_event : "session_id"
  recording_session ||--o{ emboli_event : "session_id"
  surgical_case ||--o{ recording_session : "case_id"
  device ||--o{ recording_session : "device_id"
  recording_session ||--o{ setting_change : "session_id"
  staff |o--o{ setting_change : "staff_id"
  recording_session ||..o{ raw_sample : "session_id"
  channel ||..o{ raw_sample : "channel_id"
  sample_quality ||..o{ raw_sample : "quality"
```

## Aggregates

```mermaid
---
title: "Aggregates: minute > hour > day, dirty queue, case phases"
---
erDiagram
  agg_minute {
    integer session_id PK,FK "logical FK"
    smallint channel_id PK,FK "logical FK"
    timestamptz bucket PK
    integer n_valid
    integer n_bad
    float8 sum
    float8 sum_sq
    real min
    timestamptz t_min
    real max
    timestamptz t_max
    real first_val
    timestamptz first_ts
    real last_val
    timestamptz last_ts
    real sec_below
    real sec_above
  }
  agg_hour {
    integer session_id PK,FK "logical FK"
    smallint channel_id PK,FK "logical FK"
    timestamptz bucket PK
    integer n_valid
    integer n_bad
    float8 sum
    float8 sum_sq
    real min
    timestamptz t_min
    real max
    timestamptz t_max
    real first_val
    timestamptz first_ts
    real last_val
    timestamptz last_ts
    real sec_below
    real sec_above
  }
  agg_day {
    integer session_id PK,FK "logical FK"
    smallint channel_id PK,FK "logical FK"
    timestamptz bucket PK
    integer n_valid
    integer n_bad
    float8 sum
    float8 sum_sq
    real min
    timestamptz t_min
    real max
    timestamptz t_max
    real first_val
    timestamptz first_ts
    real last_val
    timestamptz last_ts
    real sec_below
    real sec_above
  }
  agg_dirty {
    text grain PK
    integer session_id PK,FK "logical FK"
    smallint channel_id PK,FK "logical FK"
    timestamptz bucket PK
  }
  agg_case_phase {
    integer case_id PK,FK
    text phase PK
    smallint channel_id PK,FK
    timestamptz t_start
    timestamptz t_end
    integer n_valid
    integer n_bad
    real avg
    real min
    timestamptz t_min
    real max
    timestamptz t_max
    real p10
    real p50
    real p90
    real sec_below
    real sec_above
  }
  recording_session
  channel
  surgical_case
  surgical_case ||--o{ agg_case_phase : "case_id"
  channel ||--o{ agg_case_phase : "channel_id"
  recording_session ||..o{ agg_minute : "session_id"
  channel ||..o{ agg_minute : "channel_id"
  recording_session ||..o{ agg_hour : "session_id"
  channel ||..o{ agg_hour : "channel_id"
  recording_session ||..o{ agg_day : "session_id"
  channel ||..o{ agg_day : "channel_id"
  recording_session ||..o{ agg_dirty : "session_id"
  channel ||..o{ agg_dirty : "channel_id"
```
