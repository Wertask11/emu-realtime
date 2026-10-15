"""Select the application's checkbox facets using actual user input events."""
def select_facets(frame, selector, values):
    if isinstance(values, str):
        values = [values]
    group = frame.locator(selector)
    # Open optional classification sections using their real disclosure control.
    for details in group.locator('xpath=ancestor::details').all():
        if details.get_attribute('open') is None:
            details.locator(':scope > summary').click()
    group.wait_for(state='visible')
    choices = group.locator('input[type="checkbox"]')
    available = [item.get_attribute('value') for item in choices.all()]
    missing = set(values) - set(available)
    assert not missing, (selector, missing)
    for item in choices.all():
        item.set_checked(item.get_attribute('value') in values)
