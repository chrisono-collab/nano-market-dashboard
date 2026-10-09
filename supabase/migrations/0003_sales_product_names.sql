-- Every product name in our sales history (VendSoft + USAT), with recent
-- popularity, for the Moneta product-mapping picklist.
create or replace view sales_product_names with (security_invoker = true) as
select product_name,
       max(sale_day) as last_sold,
       sum(quantity) filter (where sale_day > current_date - 90) as units_90d
from sales_line_items
group by product_name;
