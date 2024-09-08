"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useTeam } from "@/context/team-context";
import { ItemType, ViewerGroupAccessControls } from "@prisma/client";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownToLineIcon,
  ChevronDown,
  ChevronRight,
  EyeIcon,
  EyeOffIcon,
  File,
  Folder,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

import CloudDownloadOff from "@/components/shared/icons/cloud-download-off";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { useDataroomFoldersTree } from "@/lib/swr/use-dataroom";
import { cn } from "@/lib/utils";

// Update the FileOrFolder type to include permissions
type FileOrFolder = {
  id: string;
  name: string;
  subItems?: FileOrFolder[];
  permissions: {
    view: boolean;
    download: boolean;
    partialView?: boolean;
  };
  itemType: ItemType;
  documentId?: string;
};

type ItemPermission = Record<
  string,
  {
    view: boolean;
    download: boolean;
    // partialView?: boolean;
    itemType: ItemType;
  }
>;

type ColumnExtra = {
  updatePermissions: (id: string, newPermissions: string[]) => void;
};

const createColumns = (extra: ColumnExtra): ColumnDef<FileOrFolder>[] => [
  {
    id: "expander",
    header: () => null,
    cell: ({ row }) => {
      return row.getCanExpand() ? (
        <Button
          variant="ghost"
          onClick={row.getToggleExpandedHandler()}
          className="h-6 w-6 p-0"
        >
          {row.getIsExpanded() ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      ) : null;
    },
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex items-center text-foreground">
        {row.original.itemType === ItemType.DATAROOM_FOLDER ? (
          <Folder className="mr-2 h-5 w-5" />
        ) : (
          <File className="mr-2 h-5 w-5" />
        )}
        <span className="truncate">{row.original.name}</span>
      </div>
    ),
  },
  {
    id: "actions",
    header: "Actions",
    cell: ({ row }) => {
      const item = row.original;

      const handleValueChange = (value: string[]) => {
        extra.updatePermissions(item.id, value);
      };

      return (
        <ToggleGroup
          type="multiple"
          value={Object.entries(item.permissions)
            .filter(([_, value]) => value)
            .map(([key, _]) => key)}
          onValueChange={handleValueChange}
        >
          <ToggleGroupItem
            value="view"
            aria-label="Toggle view"
            size="sm"
            className={cn(
              "text-muted-foreground hover:ring-1 hover:ring-gray-400 data-[state=on]:bg-foreground data-[state=on]:text-background",
              item.permissions.view
                ? item.permissions.partialView
                  ? "data-[state=on]:bg-gray-400 data-[state=on]:text-background"
                  : "data-[state=on]:bg-foreground data-[state=on]:text-background"
                : "",
            )}
          >
            {item.permissions.view || item.permissions.partialView ? (
              <EyeIcon className="h-5 w-5" />
            ) : (
              <EyeOffIcon className="h-5 w-5" />
            )}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="download"
            aria-label="Toggle download"
            size="sm"
            className="text-muted-foreground hover:ring-1 hover:ring-gray-400 data-[state=on]:bg-foreground data-[state=on]:text-background"
          >
            {item.permissions.download ? (
              <ArrowDownToLineIcon className="h-5 w-5" />
            ) : (
              <CloudDownloadOff className="h-5 w-5" />
            )}
          </ToggleGroupItem>
        </ToggleGroup>
      );
    },
  },
];

// Update the buildTree function to include permissions
const buildTree = (
  items: any[],
  permissions: ViewerGroupAccessControls[],
  parentId: string | null = null,
): FileOrFolder[] => {
  const getPermissions = (id: string) => {
    const permission = permissions.find((p) => p.itemId === id);
    return {
      view: permission?.canView ?? false,
      download: permission?.canDownload ?? false,
      partialView: false,
    };
  };

  const result: FileOrFolder[] = [];

  // Handle folders and their contents
  items
    .filter((item) => item.parentId === parentId && !item.document)
    .forEach((folder) => {
      const subItems = buildTree(items, permissions, folder.id);

      // Add documents directly in this folder
      const folderDocuments = (folder.documents || []).map((doc: any) => ({
        id: doc.id,
        documentId: doc.document.id,
        name: doc.document.name,
        permissions: getPermissions(doc.id),
        itemType: ItemType.DATAROOM_DOCUMENT,
      }));

      const allSubItems = [...subItems, ...folderDocuments];

      const folderPermissions = getPermissions(folder.id);

      // Calculate view and partialView
      const someSubItemViewable = allSubItems.some(
        (subItem) => subItem.permissions.view,
      );
      const allSubItemsViewable = allSubItems.every(
        (subItem) => subItem.permissions.view,
      );

      folderPermissions.view = folderPermissions.view || someSubItemViewable;
      folderPermissions.partialView =
        someSubItemViewable && !allSubItemsViewable;

      // Propagate view permission up if any subitem has view permission
      folderPermissions.view =
        folderPermissions.view ||
        allSubItems.some((subItem) => subItem.permissions.view);

      result.push({
        id: folder.id,
        name: folder.name,
        subItems: allSubItems,
        permissions: folderPermissions,
        itemType: ItemType.DATAROOM_FOLDER,
      });
    });

  // Handle documents at the current level (including root level)
  items
    .filter(
      (item) =>
        (item.parentId === parentId && item.document) ||
        (parentId === null && item.folderId === null && item.document),
    )
    .forEach((doc) => {
      result.push({
        id: doc.id,
        documentId: doc.document.id,
        name: doc.document.name,
        permissions: getPermissions(doc.id),
        itemType: ItemType.DATAROOM_DOCUMENT,
      });
    });

  return result;
};

export default function ExpandableTable({
  dataroomId,
  groupId,
  permissions,
}: {
  dataroomId: string;
  groupId: string;
  permissions: ViewerGroupAccessControls[];
}) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const { folders, loading } = useDataroomFoldersTree({
    dataroomId,
    include_documents: true,
  });
  const [data, setData] = useState<FileOrFolder[]>([]);
  const [pendingChanges, setPendingChanges] = useState<ItemPermission>({});
  const [debouncedPendingChanges] = useDebounce(pendingChanges, 2000);

  console.log("folders", folders);

  const updatePermissions = useCallback(
    (id: string, newPermissions: string[]) => {
      const findItemAndParents = (
        items: FileOrFolder[],
        targetId: string,
        parents: FileOrFolder[] = [],
      ): { item: FileOrFolder; parents: FileOrFolder[] } | null => {
        for (const item of items) {
          if (item.id === targetId) {
            return { item, parents };
          }
          if (item.subItems) {
            const result = findItemAndParents(item.subItems, targetId, [
              ...parents,
              item,
            ]);
            if (result) return result;
          }
        }
        return null;
      };

      const result = findItemAndParents(data, id);
      if (!result) return;

      const { item, parents } = result;

      const updatedPermissions = {
        view: newPermissions.includes("view"),
        download: newPermissions.includes("download"),
      };

      // Special cases
      if (!updatedPermissions.view && item.permissions.download) {
        updatedPermissions.download = false;
      } else if (updatedPermissions.download && !updatedPermissions.view) {
        updatedPermissions.view = true;
      }

      setData((prevData) => {
        const updateItemInTree = (items: FileOrFolder[]): FileOrFolder[] => {
          return items.map((currentItem) => {
            if (currentItem.id === id) {
              const updatedItem = {
                ...currentItem,
                permissions: {
                  view: updatedPermissions.view,
                  download: updatedPermissions.download,
                  partialView: false,
                },
              };

              // If it's a folder, update all subitems
              if (updatedItem.itemType === ItemType.DATAROOM_FOLDER) {
                updatedItem.subItems = updateSubItems(
                  updatedItem.subItems || [],
                  updatedPermissions.view,
                );
              }

              return updatedItem;
            }
            if (parents.some((parent) => parent.id === currentItem.id)) {
              const updatedSubItems = currentItem.subItems
                ? updateItemInTree(currentItem.subItems)
                : [];
              const someSubItemViewable = updatedSubItems.some(
                (subItem) => subItem.permissions.view,
              );
              const allSubItemsViewable = updatedSubItems.every(
                (subItem) => subItem.permissions.view,
              );
              return {
                ...currentItem,
                permissions: {
                  view: someSubItemViewable,
                  partialView: someSubItemViewable && !allSubItemsViewable,
                  download:
                    currentItem.permissions.download && someSubItemViewable,
                },
                subItems: updatedSubItems,
              };
            }
            if (currentItem.subItems) {
              return {
                ...currentItem,
                subItems: updateItemInTree(currentItem.subItems),
              };
            }
            return currentItem;
          });
        };

        const updateSubItems = (
          items: FileOrFolder[],
          viewState: boolean,
        ): FileOrFolder[] => {
          return items.map((item) => ({
            ...item,
            permissions: {
              ...item.permissions,
              view: viewState,
              partialView: false,
              download: item.permissions.download && viewState,
            },
            subItems: item.subItems
              ? updateSubItems(item.subItems, viewState)
              : undefined,
          }));
        };

        return updateItemInTree(prevData);
      });

      const collectChanges = (
        item: FileOrFolder,
        parents: FileOrFolder[],
      ): ItemPermission => {
        let changes: ItemPermission = {
          [item.id]: {
            view: updatedPermissions.view,
            download: updatedPermissions.download,
            itemType: item.itemType,
          },
        };

        // Collect changes for all subitems
        const collectSubItemChanges = (
          subItems: FileOrFolder[] | undefined,
        ) => {
          if (!subItems) return;
          subItems.forEach((subItem) => {
            changes[subItem.id] = {
              view: updatedPermissions.view,
              download: subItem.permissions.download && updatedPermissions.view,
              itemType: subItem.itemType,
            };
            collectSubItemChanges(subItem.subItems);
          });
        };

        collectSubItemChanges(item.subItems);

        // Ensure all parent folders are viewable if the item is being set to viewable
        if (updatedPermissions.view) {
          parents.forEach((parent) => {
            changes[parent.id] = {
              view: true,
              download: parent.permissions.download,
              itemType: parent.itemType,
            };
          });
        } else {
          // If turning off view, recalculate parent permissions
          [...parents].reverse().forEach((parent) => {
            const someSubItemViewable = parent.subItems?.some((subItem) =>
              subItem.id === item.id
                ? updatedPermissions.view
                : subItem.permissions.view,
            );

            changes[parent.id] = {
              view: someSubItemViewable || false,
              download:
                (parent.permissions.download && someSubItemViewable) || false,
              itemType: parent.itemType,
            };
          });
        }

        return changes;
      };

      setPendingChanges((prev) => ({
        ...prev,
        ...collectChanges(item, parents),
      }));
    },
    [data],
  );

  useEffect(() => {
    if (folders && !loading) {
      const treeData = buildTree(folders, permissions);
      setData(treeData);
    }
  }, [folders, loading, permissions]);

  console.log("data", data);

  const saveChanges = useCallback(
    async (changes: typeof pendingChanges) => {
      try {
        const response = await fetch(
          `/api/teams/${teamId}/datarooms/${dataroomId}/groups/${groupId}/permissions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              dataroomId,
              groupId,
              permissions: changes,
            }),
          },
        );

        if (!response.ok) {
          throw new Error("Failed to save permissions");
        }

        toast.success("Permissions updated", {
          description: "The permissions have been successfully updated.",
        });

        setPendingChanges({});
      } catch (error) {
        console.error("Error saving permissions:", error);
        toast.error("Failed to update permissions", {
          description: "Please try again.",
        });
      }
    },
    [dataroomId, groupId],
  );

  useEffect(() => {
    if (Object.keys(debouncedPendingChanges).length > 0) {
      saveChanges(debouncedPendingChanges);
    }
  }, [debouncedPendingChanges, saveChanges]);

  const columns = useMemo(
    () => createColumns({ updatePermissions }),
    [updatePermissions],
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSubRows: (row) => row.subItems,
  });

  if (loading) return <div>Loading...</div>;

  console.log("permissions", permissions);

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="py-2 first:w-12 last:text-right"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    style={{
                      paddingLeft: `${row.depth * 1.25 + 1}rem`,
                    }}
                    className="py-2 last:flex last:justify-end"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
