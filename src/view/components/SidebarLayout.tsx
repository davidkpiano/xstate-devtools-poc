import { h } from "preact";
import s from "./SidebarLayout.module.css";

export interface ChildProps {
	children: any;
}

export function SidebarLayout(props: ChildProps) {
	return <div class={s.root}>{props.children}</div>;
}

export function SingleLayout(props: ChildProps) {
	return <div class={s.rootSingle}>{props.children}</div>;
}

export function PageLayout(props: ChildProps) {
	return (
		<div class={s.rootPage}>
			<div class={s.rootPageInner}>{props.children}</div>
		</div>
	);
}
