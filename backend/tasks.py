"""Tree traversal and bidirectional completion propagation."""

from collections.abc import Iterator

from .models import SubTaskNode, SubTaskUpdate


def walk(nodes: list[SubTaskNode]) -> Iterator[SubTaskNode]:
    for node in nodes:
        yield node
        yield from walk(node.children)


def find(nodes: list[SubTaskNode], identifier: str) -> SubTaskNode | None:
    return next((node for node in walk(nodes) if node.id == identifier), None)


def set_completed(node: SubTaskNode, completed: bool) -> None:
    node.is_completed = completed
    for child in node.children:
        set_completed(child, completed)


def patch_tree(nodes: list[SubTaskNode], identifier: str, patch: SubTaskUpdate) -> bool:
    for node in nodes:
        if node.id == identifier:
            if patch.is_completed is not None:
                set_completed(node, patch.is_completed)
            if patch.actual_minutes is not None:
                node.actual_minutes = patch.actual_minutes
            return True
        if patch_tree(node.children, identifier, patch):
            node.is_completed = all(child.is_completed for child in node.children)
            return True
    return False
