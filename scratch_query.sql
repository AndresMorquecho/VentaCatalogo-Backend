SELECT "to_account_type", "from_account_type", count(*) 
FROM "financial_records" 
GROUP BY "to_account_type", "from_account_type";
