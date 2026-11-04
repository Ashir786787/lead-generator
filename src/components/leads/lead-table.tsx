"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
  Globe2,
  Mail,
  MapPin,
  MoreHorizontal,
  Phone,
  Radar,
  Trash2,
  UserRound,
} from "lucide-react";
import type { LeadRow } from "@/lib/client/types";
import { ChatbotBadge, ScanOutcomeBadge, ScoreBadge, StatusBadge } from "@/components/status-badges";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SortOption } from "@/lib/data/filters";
import { relativeTime } from "@/lib/utils";

interface LeadTableProps {
  leads: LeadRow[];
  selected: RowSelectionState;
  onSelectedChange: (value: RowSelectionState) => void;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
  onScan: (lead: LeadRow) => void;
  onArchive: (lead: LeadRow) => void;
  canArchive: boolean;
}

function SortHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
    >
      {label}
      {active ? (
        direction === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-50" />
      )}
    </button>
  );
}

export function LeadTable({
  leads,
  selected,
  onSelectedChange,
  sort,
  onSortChange,
  onScan,
  onArchive,
  canArchive,
}: LeadTableProps) {
  const columns = React.useMemo<ColumnDef<LeadRow>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all rows on this page"
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.name}`}
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
          />
        ),
        enableSorting: false,
        size: 36,
      },
      {
        id: "name",
        header: () => (
          <SortHeader
            label="Business"
            active={sort === "name_asc" || sort === "name_desc"}
            direction={sort === "name_asc" ? "asc" : "desc"}
            onClick={() => onSortChange(sort === "name_asc" ? "name_desc" : "name_asc")}
          />
        ),
        cell: ({ row }) => {
          const lead = row.original;
          const whatsapp = lead.contacts.find((contact) => contact.type === "whatsapp");
          return (
            <div className="min-w-[200px] max-w-[340px]">
              <Link
                href={`/leads/${lead.id}`}
                className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline underline-offset-4"
              >
                {lead.name}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span className="truncate">{lead.category ?? "Uncategorised"}</span>
                {lead.city ? (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="size-3" />
                    {lead.city}
                  </span>
                ) : null}
                {whatsapp ? (
                  <span className="rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-medium text-success">
                    WhatsApp link
                  </span>
                ) : null}
              </div>
            </div>
          );
        },
      },
      {
        id: "score",
        header: () => (
          <SortHeader
            label="Score"
            active={sort === "score_asc" || sort === "score_desc"}
            direction={sort === "score_asc" ? "asc" : "desc"}
            onClick={() => onSortChange(sort === "score_desc" ? "score_asc" : "score_desc")}
          />
        ),
        cell: ({ row }) => <ScoreBadge score={row.original.latestScore} />,
        size: 80,
      },
      {
        id: "status",
        header: () => <span>Stage</span>,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "website",
        header: () => <span>Website check</span>,
        cell: ({ row }) => {
          const lead = row.original;
          if (!lead.websiteUrl) {
            return <span className="text-xs text-muted-foreground">No website</span>;
          }
          return (
            <div className="min-w-[150px] space-y-1">
              <a
                href={lead.websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex max-w-[180px] items-center gap-1 truncate text-xs font-medium text-primary hover:underline"
                title={lead.websiteUrl}
              >
                <Globe2 className="size-3 shrink-0" />
                <span className="truncate">{lead.websiteHost}</span>
                <ExternalLink className="size-2.5 shrink-0 opacity-60" />
              </a>
              <div className="flex flex-wrap items-center gap-1">
                <ScanOutcomeBadge outcome={lead.latestScanOutcome} />
                <ChatbotBadge result={lead.latestChatbotResult} />
              </div>
            </div>
          );
        },
      },
      {
        id: "contact",
        header: () => <span>Contact</span>,
        cell: ({ row }) => {
          const lead = row.original;
          return (
            <div className="min-w-[140px] space-y-1 text-xs">
              {lead.email ? (
                <a href={`mailto:${lead.email}`} className="flex items-center gap-1 truncate hover:underline">
                  <Mail className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{lead.email}</span>
                </a>
              ) : null}
              {lead.phone ? (
                <span className="flex items-center gap-1 truncate text-muted-foreground">
                  <Phone className="size-3 shrink-0" />
                  {lead.phone}
                </span>
              ) : null}
              {!lead.email && !lead.phone ? (
                <span className="text-muted-foreground">No contact found</span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "checked",
        header: () => (
          <SortHeader
            label="Last checked"
            active={sort === "last_checked_desc"}
            direction="desc"
            onClick={() => onSortChange("last_checked_desc")}
          />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {row.original.lastCheckedAt ? relativeTime(row.original.lastCheckedAt) : "Never"}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const lead = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="iconSm" aria-label={`Actions for ${lead.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="truncate">{lead.name}</DropdownMenuLabel>
                <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
                <DropdownMenuItem asChild>
                  <Link href={`/leads/${lead.id}`}>
                    <UserRound /> Open lead
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!lead.websiteUrl}
                  onSelect={() => onScan(lead)}
                >
                  <Radar /> Scan website
                </DropdownMenuItem>
                {lead.email ? (
                  <DropdownMenuItem asChild>
                    <a href={`mailto:${lead.email}`}>
                      <Mail /> Copy email manually
                    </a>
                  </DropdownMenuItem>
                ) : null}
                {canArchive ? (
                  <>
                    <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
                    <DropdownMenuItem onSelect={() => onArchive(lead)}>
                      <Trash2 /> Archive lead
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        enableSorting: false,
        size: 44,
      },
    ],
    [canArchive, onArchive, onScan, onSortChange, sort],
  );

  const table = useReactTable({
    data: leads,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(selected) : updater;
      onSelectedChange(next);
    },
    state: { rowSelection: selected },
    manualPagination: true,
  });

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-transparent">
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id} style={{ width: header.getSize() === 150 ? undefined : header.getSize() }}>
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined} className="data-[state=selected]:bg-primary/[0.045]">
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
