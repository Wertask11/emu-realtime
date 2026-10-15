"""Select the application's checkbox facets using actual user input events."""
def select_facets(frame, selector, values):
    if isinstance(values, str):
        values = [values]
    group = frame.locator(selector)
    group.wait_for(state='visible')
    choices = group.locator('input[type="checkbox"]')
    available = [item.get_attribute('value') for item in choices.all()]
    missing = set(values) - set(available)
    assert not missing, (selector, missing)
    for item in choices.all():
        item.set_checked(item.get_attribute('value') in values)
