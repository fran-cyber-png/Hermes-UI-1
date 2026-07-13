import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { leerColumnas, parsearInserts, type FilaCruda } from "./mysqldump.js";

/**
 * El dump de Cerberus llega como texto plano desde `/descargar-bd/` (un `mysqldump
 * --single-transaction`). NO nos conectamos a la MySQL de producción: leemos el archivo.
 *
 * Icarus ya hizo esto y falló de una forma instructiva: su primer intento parseaba con un regex
 * por fila (`import-contacts.ts:181`), frágil ante escapes. El segundo (`import-erp.py`) tokeniza
 * carácter por carácter. Nosotros vamos directo al segundo enfoque, y con tests.
 *
 * Las trampas de MySQL, todas reales:
 *   · comillas escapadas dentro de un string  → \\'
 *   · comas dentro de un string               → 'Lima, Perú'
 *   · paréntesis dentro de un string          → 'Curso (avanzado)'
 *   · NULL sin comillas                       → distinto del string 'NULL'
 *   · saltos de línea dentro de un string
 *   · varias filas en un solo INSERT          → (…),(…),(…);
 */

function filas(sql: string, tabla: string): FilaCruda[] {
  return [...parsearInserts(sql, new Set([tabla]))].map((r) => r.valores);
}

describe("parsearInserts", () => {
  test("una fila simple", () => {
    const sql = "INSERT INTO `tb_venta` VALUES (1,'GOB-00001',350.50);";
    assert.deepEqual(filas(sql, "tb_venta"), [["1", "GOB-00001", "350.50"]]);
  });

  test("varias filas en un solo INSERT — como los emite mysqldump", () => {
    const sql = "INSERT INTO `tb_venta` VALUES (1,'GOB-1'),(2,'GOB-2'),(3,'GOB-3');";
    assert.deepEqual(filas(sql, "tb_venta"), [
      ["1", "GOB-1"],
      ["2", "GOB-2"],
      ["3", "GOB-3"],
    ]);
  });

  test("NULL sin comillas NO es el string 'NULL'", () => {
    const sql = "INSERT INTO `t` VALUES (1,NULL,'NULL');";
    // El primero es ausencia de dato; el segundo es alguien que escribió la palabra.
    assert.deepEqual(filas(sql, "t"), [["1", null, "NULL"]]);
  });

  test("comas dentro de un string no parten la fila", () => {
    const sql = "INSERT INTO `t` VALUES (1,'Lima, Perú',2);";
    assert.deepEqual(filas(sql, "t"), [["1", "Lima, Perú", "2"]]);
  });

  test("paréntesis dentro de un string no cierran la fila", () => {
    const sql = "INSERT INTO `t` VALUES (1,'Curso (avanzado)');";
    assert.deepEqual(filas(sql, "t"), [["1", "Curso (avanzado)"]]);
  });

  test("comillas escapadas — el caso que rompe los regex ingenuos", () => {
    const sql = "INSERT INTO `t` VALUES (1,'D\\'Angelo');";
    assert.deepEqual(filas(sql, "t"), [["1", "D'Angelo"]]);
  });

  test("los escapes de MySQL se desescapan", () => {
    const sql = "INSERT INTO `t` VALUES (1,'a\\nb',2,'c\\\\d');";
    assert.deepEqual(filas(sql, "t"), [["1", "a\nb", "2", "c\\d"]]);
  });

  test("ignora las tablas que no pedimos", () => {
    const sql = [
      "INSERT INTO `tb_venta` VALUES (1,'v');",
      "INSERT INTO `tb_log_gigante` VALUES (1,'no me interesa');",
      "INSERT INTO `tb_cliente` VALUES (2,'c');",
    ].join("\n");
    const salida = [...parsearInserts(sql, new Set(["tb_venta", "tb_cliente"]))];
    assert.deepEqual(
      salida.map((r) => [r.tabla, r.valores[1]]),
      [
        ["tb_venta", "v"],
        ["tb_cliente", "c"],
      ],
    );
  });

  test("ignora el ruido de mysqldump (CREATE TABLE, LOCK, comentarios)", () => {
    const sql = [
      "-- MySQL dump 10.13",
      "/*!40101 SET NAMES utf8 */;",
      "DROP TABLE IF EXISTS `tb_venta`;",
      "CREATE TABLE `tb_venta` (`id` int NOT NULL, `folio` varchar(20));",
      "LOCK TABLES `tb_venta` WRITE;",
      "INSERT INTO `tb_venta` VALUES (1,'GOB-1');",
      "UNLOCK TABLES;",
    ].join("\n");
    assert.deepEqual(filas(sql, "tb_venta"), [["1", "GOB-1"]]);
  });

  test("una tabla sin comillas invertidas también se reconoce", () => {
    const sql = "INSERT INTO tb_venta VALUES (1,'GOB-1');";
    assert.deepEqual(filas(sql, "tb_venta"), [["1", "GOB-1"]]);
  });

  test("un salto de línea DENTRO de un string no corta la fila", () => {
    // Las observaciones de Cerberus son texto libre que la gente escribe con enters.
    const sql = "INSERT INTO `t` VALUES (1,'linea1\nlinea2');";
    assert.deepEqual(filas(sql, "t"), [["1", "linea1\nlinea2"]]);
  });

  test("un dump vacío no explota", () => {
    assert.deepEqual([...parsearInserts("", new Set(["t"]))], []);
    assert.deepEqual([...parsearInserts("-- solo comentarios", new Set(["t"]))], []);
  });
});

describe("leerColumnas", () => {
  test("CREATE TABLE en varias líneas — como lo emite mysqldump", () => {
    const dump = [
      "CREATE TABLE `tb_venta` (",
      "  `id` int NOT NULL AUTO_INCREMENT,",
      "  `folio_venta` varchar(20) DEFAULT NULL,",
      "  `monto_total` decimal(12,2) NOT NULL,",
      "  PRIMARY KEY (`id`),",
      "  KEY `idx_folio` (`folio_venta`),",
      "  CONSTRAINT `fk_x` FOREIGN KEY (`id`) REFERENCES `t` (`id`)",
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
    ].join("\n");
    // Solo las COLUMNAS. Ni PRIMARY KEY, ni KEY, ni CONSTRAINT.
    assert.deepEqual(leerColumnas(dump).get("tb_venta"), ["id", "folio_venta", "monto_total"]);
  });

  test("CREATE TABLE en UNA sola línea — no todos los dumps van multilinea", () => {
    const dump = "CREATE TABLE `t` (`id` int NOT NULL, `nombre` varchar(100)) ENGINE=InnoDB;";
    assert.deepEqual(leerColumnas(dump).get("t"), ["id", "nombre"]);
  });

  test("un tipo con coma adentro no parte la columna", () => {
    // `decimal(12,2)` tiene una coma. Si partiéramos por comas a ciegas, se rompería.
    const dump = "CREATE TABLE `t` (`a` decimal(12,2), `b` enum('x','y'), `c` int) ENGINE=InnoDB;";
    assert.deepEqual(leerColumnas(dump).get("t"), ["a", "b", "c"]);
  });

  test("sin ENGINE al final también se lee", () => {
    const dump = "CREATE TABLE `t` (`id` int, `x` varchar(10));";
    assert.deepEqual(leerColumnas(dump).get("t"), ["id", "x"]);
  });
});
