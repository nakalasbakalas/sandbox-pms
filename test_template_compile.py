#!/usr/bin/env python
import sys
import os
sys.path.insert(0, '/d/sandbox-pms/sandbox_pms_mvp')

# Test template compilation
from flask import Flask
from jinja2 import Environment, FileSystemLoader

app = Flask(__name__)
app.config['TESTING'] = True

# Try to load and compile the template
try:
    env = Environment(loader=FileSystemLoader('/d/sandbox-pms/sandbox_pms_mvp/templates'))
    template = env.get_template('housekeeping_board.html')
    print("✓ Template loads successfully")

    # Try rendering with minimal context
    context = {
        'hotel_name': 'Test Hotel',
        'board': {
            'business_date': __import__('datetime').date.today(),
            'refreshed_at': __import__('datetime').datetime.now(),
            'counts': {'dirty': 1, 'clean': 2, 'inspected': 3, 'blocked': 0, 'out_of_order': 0, 'maintenance': 0},
            'items': []
        },
        'tomorrow_board': {
            'business_date': __import__('datetime').date.today() + __import__('datetime').timedelta(days=1),
            'counts': {'dirty': 0, 'clean': 1, 'inspected': 0, 'blocked': 0, 'out_of_order': 0, 'maintenance': 0},
            'items': []
        },
        'today_date': __import__('datetime').date.today(),
        'filters': {
            'floor': '',
            'status': '',
            'priority': '',
            'room_type_id': '',
            'arrival_today': '',
            'departure_today': ''
        },
        'room_types': [],
        'housekeeping_statuses': ['dirty', 'clean'],
        'can_manage_controls': False,
        'can': lambda x: False,
        'csrf_input': lambda: '<input>',
        'url_for': lambda x, **kw: '#'
    }

    output = template.render(**context)
    print("✓ Template renders with test context")
    print(f"✓ Output length: {len(output)} characters")

except Exception as e:
    print(f"✗ Error: {e}")
    import traceback
    traceback.print_exc()
