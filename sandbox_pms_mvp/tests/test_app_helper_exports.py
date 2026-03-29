from pms import app as app_module
from pms import helpers


def test_app_reuses_shared_helper_functions():
    assert app_module.current_user is helpers.current_user
    assert app_module.require_user is helpers.require_user
    assert app_module.current_settings is helpers.current_settings
    assert app_module.safe_back_path is helpers.safe_back_path
    assert app_module.parse_request_date_arg is helpers.parse_request_date_arg
    assert app_module.require_admin_workspace_access is helpers.require_admin_workspace_access
