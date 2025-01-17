import { newTestPage, getCount, clickAndWaitForHooks } from "../../test-utils";
import { expect } from "chai";
import { clickNestedText, getAttribute } from "pentf/browser_utils";
import { waitForPass } from "pentf/assert_utils";

export const description = "Inspect custom hooks";

export async function run(config: any) {
	const { devtools } = await newTestPage(config, "hooks");

	const hooksPanel = '[data-testid="props-row"]';

	// CutomHook
	await clickAndWaitForHooks(devtools, "CustomHooks");

	const isCollapsed = await getAttribute(
		devtools,
		`${hooksPanel} button`,
		"data-collapsed",
	);
	expect(isCollapsed).to.equal("true");
	expect(await getCount(devtools, hooksPanel)).to.equal(1);

	await clickNestedText(devtools, "useFoo");
	expect(await getCount(devtools, hooksPanel)).to.equal(2);

	await waitForPass(async () => {
		await clickNestedText(devtools, "useBar");
		expect(await getCount(devtools, hooksPanel)).to.equal(4);
	});

	// Collapse all hooks
	await waitForPass(async () => {
		await clickNestedText(devtools, "useFoo");
		expect(await getCount(devtools, hooksPanel)).to.equal(1);
	});
}
