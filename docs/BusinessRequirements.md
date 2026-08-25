# Business Requirements

Supports configurable API limits by IP, domain, and customer for minute, hour, and day periods. Requests above a matching limit return HTTP 429. Administrators can manage rules and inspect breach notifications. No matching rule means allow. Multiple matching rules are all enforced.
