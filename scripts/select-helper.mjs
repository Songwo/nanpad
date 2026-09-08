export async function chooseOption(page, trigger, label) {
  await trigger.click();
  await page
    .getByRole("option")
    .filter({ has: page.getByText(label, { exact: true }) })
    .click();
}

export async function verifyOptions(page, trigger, labels) {
  await trigger.click();
  const options = page.getByRole("option");
  if ((await options.count()) !== labels.length) throw new Error("Unexpected option count");
  for (const label of labels)
    await options.filter({ has: page.getByText(label, { exact: true }) }).waitFor();
  await page.keyboard.press("Escape");
}
