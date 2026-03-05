/**
 * Generates three sample files for testing Flux joins and filters:
 *   samples/test-employees.xlsx   — source A (employee master)
 *   samples/test-contracts.xlsx   — source B (contract / salary data)
 *   samples/test-output-template.xlsx — target template
 *
 * Run with:  node samples/make-test-data.mjs
 */
import * as XLSX from 'xlsx'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const out = p => path.join(__dirname, p)

// ── Employees (Source A) ───────────────────────────────────────────────────────
// 10 employees: mix of Active / Inactive, some won't have a contract row (to
// test left-join unmatched and inner-join exclusion behaviour).

const employees = [
  { EmployeeID: 'E001', FirstName: 'Alice',   LastName: 'Martin',   Department: 'Engineering', Status: 'Active' },
  { EmployeeID: 'E002', FirstName: 'Bob',     LastName: 'Nguyen',   Department: 'Sales',       Status: 'Active' },
  { EmployeeID: 'E003', FirstName: 'Carol',   LastName: 'Smith',    Department: 'HR',          Status: 'Inactive' },
  { EmployeeID: 'E004', FirstName: 'David',   LastName: 'Lee',      Department: 'Engineering', Status: 'Active' },
  { EmployeeID: 'E005', FirstName: 'Eva',     LastName: 'Kowalski', Department: 'Finance',     Status: 'Active' },
  { EmployeeID: 'E006', FirstName: 'Frank',   LastName: 'Müller',   Department: 'Sales',       Status: 'Inactive' },
  { EmployeeID: 'E007', FirstName: 'Grace',   LastName: 'Chen',     Department: 'Engineering', Status: 'Active' },
  { EmployeeID: 'E008', FirstName: 'Henry',   LastName: 'Dupont',   Department: 'HR',          Status: 'Active' },
  { EmployeeID: 'E009', FirstName: 'Iris',    LastName: 'Tanaka',   Department: 'Finance',     Status: 'Inactive' },
  // E010 has no contract row → tests left-join (appears in output with blank salary) vs inner-join (excluded)
  { EmployeeID: 'E010', FirstName: 'James',   LastName: 'Brown',    Department: 'Engineering', Status: 'Active' },
]

// ── Contracts / Salary (Source B) ─────────────────────────────────────────────
// Matches most employees. C999 has no matching employee → tests right-join.

const contracts = [
  { ContractID: 'C001', EmpID: 'E001', AnnualSalary: '75000', BonusPct: '10', StartDate: '2022-03-01', ContractType: 'Permanent' },
  { ContractID: 'C002', EmpID: 'E002', AnnualSalary: '62000', BonusPct: '8',  StartDate: '2021-07-15', ContractType: 'Permanent' },
  { ContractID: 'C003', EmpID: 'E003', AnnualSalary: '55000', BonusPct: '5',  StartDate: '2020-01-10', ContractType: 'Fixed-term' },
  { ContractID: 'C004', EmpID: 'E004', AnnualSalary: '88000', BonusPct: '12', StartDate: '2023-06-01', ContractType: 'Permanent' },
  { ContractID: 'C005', EmpID: 'E005', AnnualSalary: '91000', BonusPct: '15', StartDate: '2019-11-20', ContractType: 'Permanent' },
  { ContractID: 'C006', EmpID: 'E006', AnnualSalary: '60000', BonusPct: '7',  StartDate: '2021-03-05', ContractType: 'Fixed-term' },
  { ContractID: 'C007', EmpID: 'E007', AnnualSalary: '82000', BonusPct: '11', StartDate: '2022-09-12', ContractType: 'Permanent' },
  { ContractID: 'C008', EmpID: 'E008', AnnualSalary: '58000', BonusPct: '6',  StartDate: '2020-05-30', ContractType: 'Permanent' },
  { ContractID: 'C009', EmpID: 'E009', AnnualSalary: '69000', BonusPct: '9',  StartDate: '2018-08-01', ContractType: 'Fixed-term' },
  // C999: no matching employee — tests right-join (appears) vs inner/left-join (excluded)
  { ContractID: 'C999', EmpID: 'E999', AnnualSalary: '50000', BonusPct: '5',  StartDate: '2024-01-01', ContractType: 'Consultant' },
]

// ── Output template columns ────────────────────────────────────────────────────
// Target file: one header row (row 0), data starts at row 1.
const templateHeaders = [
  'EmployeeID', 'FullName', 'Department', 'Status',
  'ContractType', 'AnnualSalary', 'BonusPct', 'StartDate',
]

// ── Write employees.xlsx ───────────────────────────────────────────────────────
{
  const ws = XLSX.utils.json_to_sheet(employees)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Employees')
  XLSX.writeFile(wb, out('test-employees.xlsx'))
  console.log('✓ test-employees.xlsx  (%d rows)', employees.length)
}

// ── Write contracts.xlsx ───────────────────────────────────────────────────────
{
  const ws = XLSX.utils.json_to_sheet(contracts)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Contracts')
  XLSX.writeFile(wb, out('test-contracts.xlsx'))
  console.log('✓ test-contracts.xlsx  (%d rows)', contracts.length)
}

// ── Write output template ──────────────────────────────────────────────────────
{
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([templateHeaders])
  // Style note: Flux will fill rows from row index 1 onward (header at row 0).
  XLSX.utils.book_append_sheet(wb, ws, 'Output')
  XLSX.writeFile(wb, out('test-output-template.xlsx'))
  console.log('✓ test-output-template.xlsx  (header only)')
}

console.log('\nDone. Import these files in Flux:')
console.log('  Sources  → test-employees.xlsx, test-contracts.xlsx')
console.log('  Targets  → test-output-template.xlsx  (header row: 1, data start: 2)')
console.log('\nJoin config:  EmployeeID (A) ↔ EmpID (B)')
console.log('Filter ideas: Status = Active  |  AnnualSalary > 70000  |  Department = Engineering')
