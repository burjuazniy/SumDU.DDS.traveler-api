-- DML example: touch every plan (returns the affected row count per vnode).
UPDATE travel_plans SET tags = tags WHERE true;
