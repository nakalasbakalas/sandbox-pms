#!/usr/bin/env python
import sys
import os
sys.path.insert(0, os.path.abspath('.'))

from sandbox_pms_mvp.tests.conftest import app_factory
from sandbox_pms_mvp.tests.helpers import login_as, make_staff_user

def main():
    app_fact = app_factory()
    app = app_fact(seed=True)
    client = app.test_client()

    with app.app_context():
        user = make_staff_user("housekeeping", "hk-mobile@example.com")

    login_as(client, user)
    response = client.get("/staff/housekeeping?view=mobile")

    print(f"Status Code: {response.status_code}")
    print(f"\nResponse Data:\n")
    data = response.get_data(as_text=True)

    # Print first 2000 chars
    print(data[:2000])

    if response.status_code != 200:
        print("\n\n=== Full Response (last 2000 chars) ===\n")
        print(data[-2000:])

if __name__ == '__main__':
    main()
