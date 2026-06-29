/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19-11.8.6-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: postfixadmin
-- ------------------------------------------------------
-- Server version	11.8.6-MariaDB-0+deb13u1 from Debian

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;

--
-- Current Database: `postfixadmin`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `postfixadmin` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci */;

USE `postfixadmin`;

--
-- Table structure for table `admin`
--

DROP TABLE IF EXISTS `admin`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin` (
  `username` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `created` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `modified` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `superadmin` tinyint(1) NOT NULL DEFAULT 0,
  `phone` varchar(30) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT '',
  `email_other` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT '',
  `token` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT '',
  `token_validity` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  PRIMARY KEY (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci COMMENT='Postfix Admin - Virtual Admins';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `admin`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `admin` WRITE;
/*!40000 ALTER TABLE `admin` DISABLE KEYS */;
INSERT INTO `admin` VALUES
('superadmin@housevo.us','{SHA512-CRYPT}$6$TW.Sl7v.hJHqENQf$5sZyO4wjynaAwKvHsslcCSBMFvEbUDbNCx2h.VW9HYQ3OKGMB3B.6snQiczVRcgqnS/mxr/JH9FJsmuWOP5..0','2000-01-01 00:00:00','2000-01-01 00:00:00',1,1,'','','','2000-01-01 00:00:00'),
('thang@housevo.us','{BLF-CRYPT}$2y$05$Jvi3ZnkZsanX3EHWxRkB6e0DsuB7KZfm9o0.Nf/peApMTJc7bWHkC','2026-03-06 17:53:58','2026-03-07 18:06:01',1,1,'','','','2026-03-06 16:53:57');
/*!40000 ALTER TABLE `admin` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `alias`
--

DROP TABLE IF EXISTS `alias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `alias` (
  `address` varchar(255) NOT NULL,
  `goto` text NOT NULL,
  `domain` varchar(255) NOT NULL,
  `created` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `modified` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`address`),
  KEY `domain` (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci COMMENT='Postfix Admin - Virtual Aliases';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `alias`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `alias` WRITE;
/*!40000 ALTER TABLE `alias` DISABLE KEYS */;
INSERT INTO `alias` VALUES
('@housevo.us','thang@housevo.us','housevo.us','2026-03-06 18:20:00','2026-03-06 18:20:00',1),
('abuse@housevo.us','thang@housevo.us','housevo.us','2026-03-06 17:58:12','2026-03-06 18:15:35',1),
('bills@housevo.us','thang@housevo.us,melissa@housevo.us','housevo.us','2026-03-06 18:18:13','2026-03-06 18:18:13',1),
('hostmaster@housevo.us','thang@housevo.us','housevo.us','2026-03-06 17:58:12','2026-03-06 18:15:49',1),
('hvc@housevo.us','thang@housevo.us,melissa@housevo.us','housevo.us','2026-03-06 18:17:41','2026-03-06 18:17:41',1),
('melissa@housevo.us','melissa@housevo.us','housevo.us','2026-03-06 18:01:21','2026-03-06 18:01:21',1),
('postmaster@housevo.us','thang@housevo.us','housevo.us','2026-03-06 17:58:12','2026-03-06 18:15:59',1),
('thang@housevo.us','thang@housevo.us','housevo.us','2026-03-06 18:00:30','2026-03-06 18:00:30',1),
('webmaster@housevo.us','thang@housevo.us','housevo.us','2026-03-06 17:58:12','2026-03-06 18:16:07',1);
/*!40000 ALTER TABLE `alias` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `alias_domain`
--

DROP TABLE IF EXISTS `alias_domain`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `alias_domain` (
  `alias_domain` varchar(255) NOT NULL DEFAULT '',
  `target_domain` varchar(255) NOT NULL DEFAULT '',
  `created` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `modified` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`alias_domain`),
  KEY `active` (`active`),
  KEY `target_domain` (`target_domain`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci COMMENT='Postfix Admin - Domain Aliases';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `alias_domain`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `alias_domain` WRITE;
/*!40000 ALTER TABLE `alias_domain` DISABLE KEYS */;
/*!40000 ALTER TABLE `alias_domain` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `api_keys`
--

DROP TABLE IF EXISTS `api_keys`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `api_keys` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `description` varchar(255) NOT NULL,
  `key_hash` varchar(255) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `last_used` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `api_keys`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `api_keys` WRITE;
/*!40000 ALTER TABLE `api_keys` DISABLE KEYS */;
/*!40000 ALTER TABLE `api_keys` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `calendars`
--

DROP TABLE IF EXISTS `calendars`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendars` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `color` varchar(7) DEFAULT '#3498db',
  `sync_token` int(11) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=149 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calendars`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `calendars` WRITE;
/*!40000 ALTER TABLE `calendars` DISABLE KEYS */;
INSERT INTO `calendars` VALUES
(1,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 01:24:34'),
(2,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:06:11'),
(3,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:06:11'),
(4,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:06:12'),
(5,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:06:52'),
(6,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:06:52'),
(7,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:06:52'),
(8,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:24:26'),
(9,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:24:27'),
(10,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:24:27'),
(11,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:25:11'),
(12,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:25:11'),
(13,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:25:11'),
(14,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:42:19'),
(15,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:42:19'),
(16,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:42:19'),
(17,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:42:35'),
(18,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:42:36'),
(19,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 03:42:37'),
(20,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:00:30'),
(21,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:00:30'),
(22,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:00:30'),
(23,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:00:32'),
(24,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:00:33'),
(25,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:00:34'),
(26,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:18:46'),
(27,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:18:47'),
(28,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:18:47'),
(29,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:19:04'),
(30,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:19:04'),
(31,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:19:04'),
(32,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:36:12'),
(33,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:36:12'),
(34,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:36:12'),
(35,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:36:22'),
(36,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:36:23'),
(37,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:36:24'),
(38,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:54:18'),
(39,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:54:18'),
(40,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:54:19'),
(41,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:54:35'),
(42,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:54:36'),
(43,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 04:54:36'),
(44,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:12:13'),
(45,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:12:14'),
(46,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:12:14'),
(47,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:12:30'),
(48,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:12:30'),
(49,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:12:31'),
(50,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:30:12'),
(51,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:30:12'),
(52,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:30:12'),
(53,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:30:48'),
(54,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:30:49'),
(55,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:30:49'),
(56,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:48:30'),
(57,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:48:30'),
(58,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:48:30'),
(59,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:48:41'),
(60,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:48:41'),
(61,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 05:48:42'),
(62,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:06:16'),
(63,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:06:16'),
(64,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:06:17'),
(65,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:06:56'),
(66,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:06:56'),
(67,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:06:56'),
(68,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:25:02'),
(69,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:25:03'),
(70,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:25:04'),
(71,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:25:11'),
(72,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:25:12'),
(73,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:25:12'),
(74,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:42:23'),
(75,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:42:23'),
(76,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:42:23'),
(77,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:42:41'),
(78,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:42:41'),
(79,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 06:42:42'),
(80,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:00:11'),
(81,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:00:12'),
(82,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:00:13'),
(83,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:00:48'),
(84,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:00:48'),
(85,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:00:48'),
(86,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:18:11'),
(87,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:18:11'),
(88,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:18:12'),
(89,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:18:12'),
(90,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:18:12'),
(91,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:18:13'),
(92,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:36:19'),
(93,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:36:20'),
(94,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:36:20'),
(95,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:36:38'),
(96,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:36:38'),
(97,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:36:39'),
(98,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:54:11'),
(99,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:54:11'),
(100,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:54:12'),
(101,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:54:27'),
(102,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:54:27'),
(103,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 07:54:27'),
(104,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:11:57'),
(105,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:11:58'),
(106,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:11:59'),
(107,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:12:42'),
(108,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:12:42'),
(109,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:12:42'),
(110,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:30:05'),
(111,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:30:06'),
(112,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:30:07'),
(113,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:31:12'),
(114,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:31:12'),
(115,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:31:12'),
(116,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:48:30'),
(117,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:48:30'),
(118,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:48:31'),
(119,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:48:37'),
(120,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:48:38'),
(121,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 08:48:38'),
(122,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:06:43'),
(123,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:06:43'),
(124,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:06:43'),
(125,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:06:45'),
(126,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:06:46'),
(127,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:06:47'),
(128,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:24:58'),
(129,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:24:58'),
(130,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:24:58'),
(131,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:25:03'),
(132,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:25:04'),
(133,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:25:05'),
(134,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:42:13'),
(135,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:42:13'),
(136,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:42:13'),
(137,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:42:15'),
(138,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:42:16'),
(139,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 09:42:16'),
(140,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:00:28'),
(141,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:00:28'),
(142,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:00:28'),
(143,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:00:40'),
(144,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:00:41'),
(145,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:00:42'),
(146,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:18:56'),
(147,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:18:57'),
(148,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:18:57');
/*!40000 ALTER TABLE `calendars` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `config`
--

DROP TABLE IF EXISTS `config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(20) CHARACTER SET latin1 COLLATE latin1_general_ci NOT NULL DEFAULT '',
  `value` varchar(20) CHARACTER SET latin1 COLLATE latin1_general_ci NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='PostfixAdmin settings';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `config`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `config` WRITE;
/*!40000 ALTER TABLE `config` DISABLE KEYS */;
INSERT INTO `config` VALUES
(1,'version','1847');
/*!40000 ALTER TABLE `config` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `contacts`
--

DROP TABLE IF EXISTS `contacts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contacts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `phone` varchar(255) DEFAULT NULL,
  `vcard_data` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_email` (`username`,`email`),
  KEY `username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `contacts`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `contacts` WRITE;
/*!40000 ALTER TABLE `contacts` DISABLE KEYS */;
INSERT INTO `contacts` VALUES
(1,'melissa@housevo.us','Thang Vo','thang@housevo.us','2026-06-20 21:27:23',NULL,NULL),
(2,'thang@housevo.us','Melissa Vo','melissa@housevo.us','2026-06-20 21:27:23',NULL,NULL);
/*!40000 ALTER TABLE `contacts` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `domain`
--

DROP TABLE IF EXISTS `domain`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `domain` (
  `domain` varchar(255) NOT NULL,
  `description` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  `aliases` int(10) NOT NULL DEFAULT 0,
  `mailboxes` int(10) NOT NULL DEFAULT 0,
  `maxquota` bigint(20) NOT NULL DEFAULT 0,
  `quota` bigint(20) NOT NULL DEFAULT 0,
  `transport` varchar(255) NOT NULL,
  `backupmx` tinyint(1) NOT NULL DEFAULT 0,
  `created` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `modified` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `password_expiry` int(11) DEFAULT 0,
  PRIMARY KEY (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci COMMENT='Postfix Admin - Virtual Domains';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `domain`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `domain` WRITE;
/*!40000 ALTER TABLE `domain` DISABLE KEYS */;
INSERT INTO `domain` VALUES
('ALL','',0,0,0,0,'',0,'2026-03-06 17:49:27','2026-03-06 17:49:27',1,0),
('housevo.us','House Vo',0,0,0,0,'virtual',0,'2026-03-06 17:58:12','2026-03-06 17:58:12',1,0);
/*!40000 ALTER TABLE `domain` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `domain_admins`
--

DROP TABLE IF EXISTS `domain_admins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `domain_admins` (
  `username` varchar(255) NOT NULL,
  `domain` varchar(255) NOT NULL,
  `created` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `id` int(11) NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  KEY `username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci COMMENT='Postfix Admin - Domain Admins';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `domain_admins`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `domain_admins` WRITE;
/*!40000 ALTER TABLE `domain_admins` DISABLE KEYS */;
INSERT INTO `domain_admins` VALUES
('thang@housevo.us','ALL','2026-03-06 17:53:58',1,1);
/*!40000 ALTER TABLE `domain_admins` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `domain_spam_rules`
--

DROP TABLE IF EXISTS `domain_spam_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `domain_spam_rules` (
  `domain` varchar(255) NOT NULL,
  `rules_json` text DEFAULT NULL,
  PRIMARY KEY (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `domain_spam_rules`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `domain_spam_rules` WRITE;
/*!40000 ALTER TABLE `domain_spam_rules` DISABLE KEYS */;
/*!40000 ALTER TABLE `domain_spam_rules` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `domain_verification`
--

DROP TABLE IF EXISTS `domain_verification`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `domain_verification` (
  `domain` varchar(255) NOT NULL,
  `token` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `domain_verification`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `domain_verification` WRITE;
/*!40000 ALTER TABLE `domain_verification` DISABLE KEYS */;
/*!40000 ALTER TABLE `domain_verification` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `events`
--

DROP TABLE IF EXISTS `events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `events` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `calendar_id` int(11) NOT NULL,
  `uid` varchar(255) NOT NULL,
  `ical_data` text NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `cal_uid` (`calendar_id`,`uid`),
  CONSTRAINT `events_ibfk_1` FOREIGN KEY (`calendar_id`) REFERENCES `calendars` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `events`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `events` WRITE;
/*!40000 ALTER TABLE `events` DISABLE KEYS */;
/*!40000 ALTER TABLE `events` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `fetchmail`
--

DROP TABLE IF EXISTS `fetchmail`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `fetchmail` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `mailbox` varchar(255) NOT NULL,
  `src_server` varchar(255) NOT NULL,
  `src_auth` enum('password','kerberos_v5','kerberos','kerberos_v4','gssapi','cram-md5','otp','ntlm','msn','ssh','any') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `src_user` varchar(255) NOT NULL,
  `src_password` varchar(255) NOT NULL,
  `src_folder` varchar(255) NOT NULL,
  `poll_time` int(11) unsigned NOT NULL DEFAULT 10,
  `fetchall` tinyint(1) unsigned NOT NULL DEFAULT 0,
  `keep` tinyint(1) unsigned NOT NULL DEFAULT 0,
  `protocol` enum('POP3','IMAP','POP2','ETRN','AUTO') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `usessl` tinyint(1) unsigned NOT NULL DEFAULT 0,
  `extra_options` text DEFAULT NULL,
  `returned_text` text DEFAULT NULL,
  `mda` varchar(255) NOT NULL,
  `date` timestamp NOT NULL DEFAULT '1999-12-31 23:00:00',
  `sslcertck` tinyint(1) NOT NULL DEFAULT 0,
  `sslcertpath` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT '',
  `sslfingerprint` varchar(255) DEFAULT '',
  `domain` varchar(255) DEFAULT '',
  `active` tinyint(1) NOT NULL DEFAULT 0,
  `created` timestamp NOT NULL DEFAULT '1999-12-31 23:00:00',
  `modified` timestamp NOT NULL DEFAULT current_timestamp(),
  `src_port` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `fetchmail`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `fetchmail` WRITE;
/*!40000 ALTER TABLE `fetchmail` DISABLE KEYS */;
/*!40000 ALTER TABLE `fetchmail` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `global_spam_rules`
--

DROP TABLE IF EXISTS `global_spam_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `global_spam_rules` (
  `id` int(11) NOT NULL DEFAULT 1,
  `rules_json` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `global_spam_rules`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `global_spam_rules` WRITE;
/*!40000 ALTER TABLE `global_spam_rules` DISABLE KEYS */;
INSERT INTO `global_spam_rules` VALUES
(1,'{\"whitelisted_senders\":[],\"blacklisted_senders\":[],\"banned_ips\":[],\"banned_extensions\":[]}');
/*!40000 ALTER TABLE `global_spam_rules` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `log`
--

DROP TABLE IF EXISTS `log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `log` (
  `timestamp` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `username` varchar(255) NOT NULL,
  `domain` varchar(255) NOT NULL,
  `action` varchar(255) NOT NULL,
  `data` text NOT NULL,
  `id` int(11) NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  KEY `timestamp` (`timestamp`),
  KEY `domain_timestamp` (`domain`,`timestamp`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci COMMENT='Postfix Admin - Log';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `log`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `log` WRITE;
/*!40000 ALTER TABLE `log` DISABLE KEYS */;
INSERT INTO `log` VALUES
('2026-03-06 17:53:58','SETUP.PHP (72.201.61.64)','','create_admin','thang@housevo.us',1),
('2026-03-06 17:58:12','thang@housevo.us (72.201.61.64)','housevo.us','create_domain','housevo.us',2),
('2026-03-06 18:00:30','thang@housevo.us (72.201.61.64)','housevo.us','create_alias','thang@housevo.us',3),
('2026-03-06 18:00:30','thang@housevo.us (72.201.61.64)','housevo.us','create_mailbox','thang@housevo.us',4),
('2026-03-06 18:01:21','thang@housevo.us (72.201.61.64)','housevo.us','create_alias','melissa@housevo.us',5),
('2026-03-06 18:01:21','thang@housevo.us (72.201.61.64)','housevo.us','create_mailbox','melissa@housevo.us',6),
('2026-03-06 18:15:35','thang@housevo.us (72.201.61.64)','housevo.us','edit_alias','abuse@housevo.us',7),
('2026-03-06 18:15:49','thang@housevo.us (72.201.61.64)','housevo.us','edit_alias','hostmaster@housevo.us',8),
('2026-03-06 18:15:59','thang@housevo.us (72.201.61.64)','housevo.us','edit_alias','postmaster@housevo.us',9),
('2026-03-06 18:16:07','thang@housevo.us (72.201.61.64)','housevo.us','edit_alias','webmaster@housevo.us',10),
('2026-03-06 18:17:41','thang@housevo.us (72.201.61.64)','housevo.us','create_alias','hvc@housevo.us',11),
('2026-03-06 18:18:13','thang@housevo.us (72.201.61.64)','housevo.us','create_alias','bills@housevo.us',12),
('2026-03-06 18:20:00','thang@housevo.us (72.201.61.64)','housevo.us','create_alias','@housevo.us',13),
('2026-03-07 18:06:01','CLI (localhost)','','edit_admin','thang@housevo.us',14);
/*!40000 ALTER TABLE `log` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `mailbox`
--

DROP TABLE IF EXISTS `mailbox`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `mailbox` (
  `username` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `maildir` varchar(255) NOT NULL,
  `quota` bigint(20) NOT NULL DEFAULT 0,
  `local_part` varchar(255) NOT NULL,
  `domain` varchar(255) NOT NULL,
  `created` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `modified` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `phone` varchar(30) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT '',
  `email_other` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT '',
  `token` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT '',
  `token_validity` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `password_expiry` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  PRIMARY KEY (`username`),
  KEY `domain` (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci COMMENT='Postfix Admin - Virtual Mailboxes';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `mailbox`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `mailbox` WRITE;
/*!40000 ALTER TABLE `mailbox` DISABLE KEYS */;
INSERT INTO `mailbox` VALUES
('melissa@housevo.us','$2y$10$TfDAe3o84s3e.D3TXCcIQuY1PmQoQj.jjSyncr59fcqr7bGuj.z2a','Melissa Vo','housevo.us/melissa/',0,'melissa','housevo.us','2026-03-06 18:01:21','2026-03-06 18:01:21',1,'','melissa.ann.vo@gmail.com','','2026-03-06 17:01:21','2026-03-06 17:01:00'),
('thang@housevo.us','$2y$10$fgXNXtWb07bA4Ij9QQasUOUxANBYd82ISZ.EBOve5Rg.9GQar/n4i','Thang Vo','housevo.us/thang/',0,'thang','housevo.us','2026-03-06 18:00:30','2026-03-06 18:00:30',1,'','rc8675309@pm.me','','2026-03-06 17:00:30','2026-03-06 17:00:00');
/*!40000 ALTER TABLE `mailbox` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `notes`
--

DROP TABLE IF EXISTS `notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notes`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `notes` WRITE;
/*!40000 ALTER TABLE `notes` DISABLE KEYS */;
/*!40000 ALTER TABLE `notes` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `quarantine_log`
--

DROP TABLE IF EXISTS `quarantine_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `quarantine_log` (
  `uuid` varchar(36) NOT NULL,
  `sender` varchar(255) DEFAULT NULL,
  `recipient` varchar(255) DEFAULT NULL,
  `subject` text DEFAULT NULL,
  `score` decimal(5,2) DEFAULT NULL,
  `file_path` varchar(500) DEFAULT NULL,
  `created` datetime DEFAULT NULL,
  PRIMARY KEY (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quarantine_log`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `quarantine_log` WRITE;
/*!40000 ALTER TABLE `quarantine_log` DISABLE KEYS */;
/*!40000 ALTER TABLE `quarantine_log` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `quota`
--

DROP TABLE IF EXISTS `quota`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `quota` (
  `username` varchar(255) NOT NULL,
  `path` varchar(100) NOT NULL,
  `current` bigint(20) NOT NULL DEFAULT 0,
  PRIMARY KEY (`username`,`path`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quota`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `quota` WRITE;
/*!40000 ALTER TABLE `quota` DISABLE KEYS */;
/*!40000 ALTER TABLE `quota` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `quota2`
--

DROP TABLE IF EXISTS `quota2`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `quota2` (
  `username` varchar(255) CHARACTER SET latin1 COLLATE latin1_general_ci NOT NULL,
  `bytes` bigint(20) NOT NULL DEFAULT 0,
  `messages` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quota2`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `quota2` WRITE;
/*!40000 ALTER TABLE `quota2` DISABLE KEYS */;
/*!40000 ALTER TABLE `quota2` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Temporary table structure for view `sogo_view`
--

DROP TABLE IF EXISTS `sogo_view`;
/*!50001 DROP VIEW IF EXISTS `sogo_view`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `sogo_view` AS SELECT
 1 AS `c_uid`,
  1 AS `c_name`,
  1 AS `c_password`,
  1 AS `c_cn`,
  1 AS `mail` */;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `tasks`
--

DROP TABLE IF EXISTS `tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tasks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `completed` tinyint(1) DEFAULT 0,
  `due_date` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tasks`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `tasks` WRITE;
/*!40000 ALTER TABLE `tasks` DISABLE KEYS */;
/*!40000 ALTER TABLE `tasks` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `user_spam_rules`
--

DROP TABLE IF EXISTS `user_spam_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_spam_rules` (
  `username` varchar(255) NOT NULL,
  `rules_json` text DEFAULT NULL,
  PRIMARY KEY (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_spam_rules`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `user_spam_rules` WRITE;
/*!40000 ALTER TABLE `user_spam_rules` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_spam_rules` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `vacation`
--

DROP TABLE IF EXISTS `vacation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vacation` (
  `email` varchar(255) NOT NULL,
  `subject` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `body` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `cache` text NOT NULL,
  `domain` varchar(255) NOT NULL,
  `created` datetime NOT NULL DEFAULT '2000-01-01 00:00:00',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `modified` timestamp NOT NULL DEFAULT current_timestamp(),
  `activefrom` timestamp NOT NULL DEFAULT '1999-12-31 23:00:00',
  `activeuntil` timestamp NOT NULL DEFAULT '2038-01-17 23:00:00',
  `interval_time` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`email`),
  KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_general_ci COMMENT='Postfix Admin - Virtual Vacation';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `vacation`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `vacation` WRITE;
/*!40000 ALTER TABLE `vacation` DISABLE KEYS */;
/*!40000 ALTER TABLE `vacation` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `vacation_notification`
--

DROP TABLE IF EXISTS `vacation_notification`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vacation_notification` (
  `on_vacation` varchar(255) CHARACTER SET latin1 COLLATE latin1_general_ci NOT NULL,
  `notified` varchar(255) CHARACTER SET latin1 COLLATE latin1_general_ci NOT NULL DEFAULT '',
  `notified_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`on_vacation`,`notified`),
  CONSTRAINT `vacation_notification_pkey` FOREIGN KEY (`on_vacation`) REFERENCES `vacation` (`email`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci COMMENT='Postfix Admin - Virtual Vacation Notifications';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `vacation_notification`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `vacation_notification` WRITE;
/*!40000 ALTER TABLE `vacation_notification` DISABLE KEYS */;
/*!40000 ALTER TABLE `vacation_notification` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping events for database 'postfixadmin'
--

--
-- Dumping routines for database 'postfixadmin'
--

--
-- Current Database: `vmail`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `vmail` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci */;

USE `vmail`;

--
-- Dumping events for database 'vmail'
--

--
-- Dumping routines for database 'vmail'
--

--
-- Current Database: `roundcube`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `roundcube` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci */;

USE `roundcube`;

--
-- Table structure for table `attachments`
--

DROP TABLE IF EXISTS `attachments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `attachments` (
  `attachment_id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `event_id` int(11) unsigned NOT NULL DEFAULT 0,
  `filename` varchar(255) NOT NULL DEFAULT '',
  `mimetype` varchar(255) NOT NULL DEFAULT '',
  `size` int(11) NOT NULL DEFAULT 0,
  `data` longtext NOT NULL,
  PRIMARY KEY (`attachment_id`),
  KEY `fk_attachments_event_id` (`event_id`),
  CONSTRAINT `fk_attachments_event_id` FOREIGN KEY (`event_id`) REFERENCES `events` (`event_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `attachments`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `attachments` WRITE;
/*!40000 ALTER TABLE `attachments` DISABLE KEYS */;
/*!40000 ALTER TABLE `attachments` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `cache`
--

DROP TABLE IF EXISTS `cache`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cache` (
  `user_id` int(10) unsigned NOT NULL,
  `cache_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  PRIMARY KEY (`user_id`,`cache_key`),
  KEY `expires_index` (`expires`),
  CONSTRAINT `user_id_fk_cache` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cache`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `cache` WRITE;
/*!40000 ALTER TABLE `cache` DISABLE KEYS */;
/*!40000 ALTER TABLE `cache` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `cache_index`
--

DROP TABLE IF EXISTS `cache_index`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cache_index` (
  `user_id` int(10) unsigned NOT NULL,
  `mailbox` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` datetime DEFAULT NULL,
  `valid` tinyint(1) NOT NULL DEFAULT 0,
  `data` longtext NOT NULL,
  PRIMARY KEY (`user_id`,`mailbox`),
  KEY `expires_index` (`expires`),
  CONSTRAINT `user_id_fk_cache_index` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cache_index`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `cache_index` WRITE;
/*!40000 ALTER TABLE `cache_index` DISABLE KEYS */;
/*!40000 ALTER TABLE `cache_index` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `cache_messages`
--

DROP TABLE IF EXISTS `cache_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cache_messages` (
  `user_id` int(10) unsigned NOT NULL,
  `mailbox` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `uid` int(11) unsigned NOT NULL DEFAULT 0,
  `expires` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `flags` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`,`mailbox`,`uid`),
  KEY `expires_index` (`expires`),
  CONSTRAINT `user_id_fk_cache_messages` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cache_messages`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `cache_messages` WRITE;
/*!40000 ALTER TABLE `cache_messages` DISABLE KEYS */;
/*!40000 ALTER TABLE `cache_messages` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `cache_shared`
--

DROP TABLE IF EXISTS `cache_shared`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cache_shared` (
  `cache_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  PRIMARY KEY (`cache_key`),
  KEY `expires_index` (`expires`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cache_shared`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `cache_shared` WRITE;
/*!40000 ALTER TABLE `cache_shared` DISABLE KEYS */;
/*!40000 ALTER TABLE `cache_shared` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `cache_thread`
--

DROP TABLE IF EXISTS `cache_thread`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cache_thread` (
  `user_id` int(10) unsigned NOT NULL,
  `mailbox` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  PRIMARY KEY (`user_id`,`mailbox`),
  KEY `expires_index` (`expires`),
  CONSTRAINT `user_id_fk_cache_thread` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cache_thread`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `cache_thread` WRITE;
/*!40000 ALTER TABLE `cache_thread` DISABLE KEYS */;
/*!40000 ALTER TABLE `cache_thread` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `calendars`
--

DROP TABLE IF EXISTS `calendars`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendars` (
  `calendar_id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL DEFAULT 0,
  `name` varchar(255) NOT NULL,
  `color` varchar(8) NOT NULL,
  `showalarms` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`calendar_id`),
  KEY `user_name_idx` (`user_id`,`name`),
  CONSTRAINT `fk_calendars_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `calendars`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `calendars` WRITE;
/*!40000 ALTER TABLE `calendars` DISABLE KEYS */;
INSERT INTO `calendars` VALUES
(1,1,'Default','cc0000',1);
/*!40000 ALTER TABLE `calendars` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `carddav_accounts`
--

DROP TABLE IF EXISTS `carddav_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `carddav_accounts` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `accountname` text NOT NULL,
  `username` varchar(255) NOT NULL,
  `password` text NOT NULL,
  `discovery_url` varchar(4095) DEFAULT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `last_discovered` bigint(20) NOT NULL DEFAULT 0,
  `rediscover_time` int(11) NOT NULL DEFAULT 86400,
  `presetname` varchar(255) DEFAULT NULL,
  `flags` smallint(5) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`,`presetname`),
  CONSTRAINT `carddav_accounts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `carddav_accounts`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `carddav_accounts` WRITE;
/*!40000 ALTER TABLE `carddav_accounts` DISABLE KEYS */;
/*!40000 ALTER TABLE `carddav_accounts` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `carddav_addressbooks`
--

DROP TABLE IF EXISTS `carddav_addressbooks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `carddav_addressbooks` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` text NOT NULL,
  `url` varchar(4095) NOT NULL,
  `flags` smallint(5) unsigned NOT NULL DEFAULT 5,
  `last_updated` bigint(20) NOT NULL DEFAULT 0,
  `refresh_time` int(11) NOT NULL DEFAULT 3600,
  `sync_token` text NOT NULL,
  `account_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`id`),
  KEY `carddav_addressbooks_ibfk_account_id` (`account_id`),
  CONSTRAINT `carddav_addressbooks_ibfk_account_id` FOREIGN KEY (`account_id`) REFERENCES `carddav_accounts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `carddav_addressbooks`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `carddav_addressbooks` WRITE;
/*!40000 ALTER TABLE `carddav_addressbooks` DISABLE KEYS */;
/*!40000 ALTER TABLE `carddav_addressbooks` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `carddav_contacts`
--

DROP TABLE IF EXISTS `carddav_contacts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `carddav_contacts` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `abook_id` int(10) unsigned NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(4095) DEFAULT NULL,
  `firstname` varchar(255) DEFAULT NULL,
  `surname` varchar(255) DEFAULT NULL,
  `organization` varchar(255) DEFAULT NULL,
  `showas` varchar(32) NOT NULL DEFAULT '',
  `vcard` longtext NOT NULL,
  `etag` varchar(255) NOT NULL,
  `uri` varchar(700) NOT NULL,
  `cuid` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uri` (`uri`,`abook_id`),
  UNIQUE KEY `cuid` (`cuid`,`abook_id`),
  KEY `abook_id` (`abook_id`),
  CONSTRAINT `carddav_contacts_ibfk_1` FOREIGN KEY (`abook_id`) REFERENCES `carddav_addressbooks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `carddav_contacts`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `carddav_contacts` WRITE;
/*!40000 ALTER TABLE `carddav_contacts` DISABLE KEYS */;
/*!40000 ALTER TABLE `carddav_contacts` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `carddav_group_user`
--

DROP TABLE IF EXISTS `carddav_group_user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `carddav_group_user` (
  `group_id` int(10) unsigned NOT NULL,
  `contact_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`group_id`,`contact_id`),
  KEY `contact_id` (`contact_id`),
  CONSTRAINT `carddav_group_user_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `carddav_groups` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `carddav_group_user_ibfk_2` FOREIGN KEY (`contact_id`) REFERENCES `carddav_contacts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `carddav_group_user`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `carddav_group_user` WRITE;
/*!40000 ALTER TABLE `carddav_group_user` DISABLE KEYS */;
/*!40000 ALTER TABLE `carddav_group_user` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `carddav_groups`
--

DROP TABLE IF EXISTS `carddav_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `carddav_groups` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `abook_id` int(10) unsigned NOT NULL,
  `name` varchar(255) NOT NULL,
  `vcard` longtext DEFAULT NULL,
  `etag` varchar(255) DEFAULT NULL,
  `uri` varchar(700) DEFAULT NULL,
  `cuid` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uri` (`uri`,`abook_id`),
  UNIQUE KEY `cuid` (`cuid`,`abook_id`),
  KEY `abook_id` (`abook_id`),
  CONSTRAINT `carddav_groups_ibfk_1` FOREIGN KEY (`abook_id`) REFERENCES `carddav_addressbooks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `carddav_groups`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `carddav_groups` WRITE;
/*!40000 ALTER TABLE `carddav_groups` DISABLE KEYS */;
/*!40000 ALTER TABLE `carddav_groups` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `carddav_migrations`
--

DROP TABLE IF EXISTS `carddav_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `carddav_migrations` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `filename` varchar(64) NOT NULL,
  `processed_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `filename` (`filename`)
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `carddav_migrations`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `carddav_migrations` WRITE;
/*!40000 ALTER TABLE `carddav_migrations` DISABLE KEYS */;
INSERT INTO `carddav_migrations` VALUES
(1,'0000-dbinit','2026-03-07 00:36:51'),
(2,'0001-categories','2026-03-07 00:36:51'),
(3,'0002-increasetextfieldlengths','2026-03-07 00:36:51'),
(4,'0003-fixtimestampdefaultvalue','2026-03-07 00:36:51'),
(5,'0004-fixtimestampdefaultvalue','2026-03-07 00:36:51'),
(6,'0005-changemysqlut8toutf8mb4','2026-03-07 00:36:51'),
(7,'0006-rmgroupsnotnull','2026-03-07 00:36:51'),
(8,'0007-replaceurlplaceholders','2026-03-07 00:36:51'),
(9,'0008-unifyindexes','2026-03-07 00:36:51'),
(10,'0009-dropauthschemefield','2026-03-07 00:36:51'),
(11,'0010-increasetextfieldlengths','2026-03-07 00:36:51'),
(12,'0011-unifymigrationsidcolumn','2026-03-07 00:36:51'),
(13,'0012-fixmysqlconstraints','2026-03-07 00:36:51'),
(14,'0013-changemysqlcollationscasesensitive','2026-03-07 00:36:51'),
(15,'0014-unifytimestampdefaultvalue','2026-03-07 00:36:51'),
(16,'0015-fixmysqlconstraints','2026-03-07 00:36:51'),
(17,'0016-increasetextfieldlengths','2026-03-07 00:36:51'),
(18,'0017-accountentities','2026-03-07 00:36:51'),
(19,'0018-accountentities2','2026-03-07 00:36:51'),
(20,'0019-accountentities3','2026-03-07 00:36:51'),
(21,'0020-distinctcolumnnames','2026-03-07 00:36:51'),
(22,'0021-addressbookflags','2026-03-07 00:36:51'),
(23,'0022-accountflags','2026-03-07 00:36:51');
/*!40000 ALTER TABLE `carddav_migrations` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `carddav_xsubtypes`
--

DROP TABLE IF EXISTS `carddav_xsubtypes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `carddav_xsubtypes` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `typename` varchar(128) NOT NULL,
  `subtype` varchar(128) NOT NULL,
  `abook_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `typename` (`typename`,`subtype`,`abook_id`),
  KEY `abook_id` (`abook_id`),
  CONSTRAINT `carddav_xsubtypes_ibfk_1` FOREIGN KEY (`abook_id`) REFERENCES `carddav_addressbooks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `carddav_xsubtypes`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `carddav_xsubtypes` WRITE;
/*!40000 ALTER TABLE `carddav_xsubtypes` DISABLE KEYS */;
/*!40000 ALTER TABLE `carddav_xsubtypes` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `collected_addresses`
--

DROP TABLE IF EXISTS `collected_addresses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `collected_addresses` (
  `address_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `changed` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  `name` varchar(255) NOT NULL DEFAULT '',
  `email` varchar(255) NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `type` int(10) unsigned NOT NULL,
  PRIMARY KEY (`address_id`),
  UNIQUE KEY `user_email_collected_addresses_index` (`user_id`,`type`,`email`),
  CONSTRAINT `user_id_fk_collected_addresses` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `collected_addresses`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `collected_addresses` WRITE;
/*!40000 ALTER TABLE `collected_addresses` DISABLE KEYS */;
INSERT INTO `collected_addresses` VALUES
(1,'2026-03-07 02:40:27','Thang.c Vo','thang.c.vo@gmail.com',1,1),
(2,'2026-03-07 02:50:46','Test Yhx1km843','test-yhx1km843@srv1.mail-tester.com',1,1);
/*!40000 ALTER TABLE `collected_addresses` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `contactgroupmembers`
--

DROP TABLE IF EXISTS `contactgroupmembers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contactgroupmembers` (
  `contactgroup_id` int(10) unsigned NOT NULL,
  `contact_id` int(10) unsigned NOT NULL,
  `created` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  PRIMARY KEY (`contactgroup_id`,`contact_id`),
  KEY `contactgroupmembers_contact_index` (`contact_id`),
  CONSTRAINT `contact_id_fk_contacts` FOREIGN KEY (`contact_id`) REFERENCES `contacts` (`contact_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `contactgroup_id_fk_contactgroups` FOREIGN KEY (`contactgroup_id`) REFERENCES `contactgroups` (`contactgroup_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `contactgroupmembers`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `contactgroupmembers` WRITE;
/*!40000 ALTER TABLE `contactgroupmembers` DISABLE KEYS */;
/*!40000 ALTER TABLE `contactgroupmembers` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `contactgroups`
--

DROP TABLE IF EXISTS `contactgroups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contactgroups` (
  `contactgroup_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `changed` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  `del` tinyint(1) NOT NULL DEFAULT 0,
  `name` varchar(128) NOT NULL DEFAULT '',
  PRIMARY KEY (`contactgroup_id`),
  KEY `contactgroups_user_index` (`user_id`,`del`),
  CONSTRAINT `user_id_fk_contactgroups` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `contactgroups`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `contactgroups` WRITE;
/*!40000 ALTER TABLE `contactgroups` DISABLE KEYS */;
/*!40000 ALTER TABLE `contactgroups` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `contacts`
--

DROP TABLE IF EXISTS `contacts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contacts` (
  `contact_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `changed` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  `del` tinyint(1) NOT NULL DEFAULT 0,
  `name` varchar(128) NOT NULL DEFAULT '',
  `email` text NOT NULL,
  `firstname` varchar(128) NOT NULL DEFAULT '',
  `surname` varchar(128) NOT NULL DEFAULT '',
  `vcard` longtext DEFAULT NULL,
  `words` text DEFAULT NULL,
  `user_id` int(10) unsigned NOT NULL,
  PRIMARY KEY (`contact_id`),
  KEY `user_contacts_index` (`user_id`,`del`),
  CONSTRAINT `user_id_fk_contacts` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `contacts`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `contacts` WRITE;
/*!40000 ALTER TABLE `contacts` DISABLE KEYS */;
/*!40000 ALTER TABLE `contacts` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `dictionary`
--

DROP TABLE IF EXISTS `dictionary`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `dictionary` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned DEFAULT NULL,
  `language` varchar(16) NOT NULL,
  `data` longtext NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniqueness` (`user_id`,`language`),
  CONSTRAINT `user_id_fk_dictionary` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `dictionary`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `dictionary` WRITE;
/*!40000 ALTER TABLE `dictionary` DISABLE KEYS */;
/*!40000 ALTER TABLE `dictionary` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `events`
--

DROP TABLE IF EXISTS `events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `events` (
  `event_id` int(11) unsigned NOT NULL AUTO_INCREMENT,
  `calendar_id` int(11) unsigned NOT NULL DEFAULT 0,
  `recurrence_id` int(11) unsigned NOT NULL DEFAULT 0,
  `uid` varchar(255) NOT NULL DEFAULT '',
  `instance` varchar(16) NOT NULL DEFAULT '',
  `isexception` tinyint(1) NOT NULL DEFAULT 0,
  `created` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  `changed` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  `sequence` int(1) unsigned NOT NULL DEFAULT 0,
  `start` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  `end` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  `recurrence` varchar(255) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `location` varchar(255) NOT NULL DEFAULT '',
  `categories` varchar(255) NOT NULL DEFAULT '',
  `url` varchar(255) NOT NULL DEFAULT '',
  `all_day` tinyint(1) NOT NULL DEFAULT 0,
  `free_busy` tinyint(1) NOT NULL DEFAULT 0,
  `priority` tinyint(1) NOT NULL DEFAULT 0,
  `sensitivity` tinyint(1) NOT NULL DEFAULT 0,
  `status` varchar(32) NOT NULL DEFAULT '',
  `alarms` text DEFAULT NULL,
  `attendees` text DEFAULT NULL,
  `notifyat` datetime DEFAULT NULL,
  PRIMARY KEY (`event_id`),
  KEY `uid_idx` (`uid`),
  KEY `recurrence_idx` (`recurrence_id`),
  KEY `calendar_notify_idx` (`calendar_id`,`notifyat`),
  CONSTRAINT `fk_events_calendar_id` FOREIGN KEY (`calendar_id`) REFERENCES `calendars` (`calendar_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `events`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `events` WRITE;
/*!40000 ALTER TABLE `events` DISABLE KEYS */;
/*!40000 ALTER TABLE `events` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `filestore`
--

DROP TABLE IF EXISTS `filestore`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `filestore` (
  `file_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `context` varchar(32) NOT NULL,
  `filename` varchar(128) NOT NULL,
  `mtime` int(10) NOT NULL,
  `data` longtext NOT NULL,
  PRIMARY KEY (`file_id`),
  UNIQUE KEY `uniqueness` (`user_id`,`context`,`filename`),
  CONSTRAINT `user_id_fk_filestore` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `filestore`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `filestore` WRITE;
/*!40000 ALTER TABLE `filestore` DISABLE KEYS */;
/*!40000 ALTER TABLE `filestore` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `identities`
--

DROP TABLE IF EXISTS `identities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identities` (
  `identity_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `changed` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  `del` tinyint(1) NOT NULL DEFAULT 0,
  `standard` tinyint(1) NOT NULL DEFAULT 0,
  `name` varchar(128) NOT NULL,
  `organization` varchar(128) NOT NULL DEFAULT '',
  `email` varchar(128) NOT NULL,
  `reply-to` varchar(128) NOT NULL DEFAULT '',
  `bcc` varchar(128) NOT NULL DEFAULT '',
  `signature` longtext DEFAULT NULL,
  `html_signature` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`identity_id`),
  KEY `user_identities_index` (`user_id`,`del`),
  KEY `email_identities_index` (`email`,`del`),
  CONSTRAINT `user_id_fk_identities` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `identities`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `identities` WRITE;
/*!40000 ALTER TABLE `identities` DISABLE KEYS */;
INSERT INTO `identities` VALUES
(1,1,'2026-03-07 16:48:38',0,1,'Thang Vo','','thang@housevo.us','','','<div class=\"pre\"><br /><span style=\"font-family: \'times new roman\', times, serif\">V/R,</span><br /><br /><span style=\"font-family: \'times new roman\', times, serif\">Thang Vo</span><br /><span style=\"font-family: \'times new roman\', times, serif\"><a href=\"mailto:thang@housevo.us\">thang@housevo.us</a></span><br /><span style=\"font-family: \'times new roman\', times, serif\">Mobile: 1-602-821-0541</span><br /><span style=\"font-family: \'times new roman\', times, serif\">Signal: tvo.23</span></div>',1),
(2,2,'2026-03-07 00:23:05',0,1,'','','melissa@housevo.us','','',NULL,0);
/*!40000 ALTER TABLE `identities` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `itipinvitations`
--

DROP TABLE IF EXISTS `itipinvitations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `itipinvitations` (
  `token` varchar(64) NOT NULL,
  `event_uid` varchar(255) NOT NULL,
  `user_id` int(10) unsigned NOT NULL DEFAULT 0,
  `event` text NOT NULL,
  `expires` datetime DEFAULT NULL,
  `cancelled` tinyint(3) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`token`),
  KEY `uid_idx` (`user_id`,`event_uid`),
  CONSTRAINT `fk_itipinvitations_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `itipinvitations`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `itipinvitations` WRITE;
/*!40000 ALTER TABLE `itipinvitations` DISABLE KEYS */;
/*!40000 ALTER TABLE `itipinvitations` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_configuration`
--

DROP TABLE IF EXISTS `kolab_cache_configuration`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_configuration` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `msguid` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  `type` varchar(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  PRIMARY KEY (`folder_id`,`msguid`),
  KEY `configuration_type` (`folder_id`,`type`),
  KEY `configuration_uid2msguid` (`folder_id`,`uid`,`msguid`),
  CONSTRAINT `fk_kolab_cache_configuration_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_configuration`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_configuration` WRITE;
/*!40000 ALTER TABLE `kolab_cache_configuration` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_configuration` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_contact`
--

DROP TABLE IF EXISTS `kolab_cache_contact`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_contact` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `msguid` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  `type` varchar(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `name` varchar(255) NOT NULL,
  `firstname` varchar(255) NOT NULL,
  `surname` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  PRIMARY KEY (`folder_id`,`msguid`),
  KEY `contact_type` (`folder_id`,`type`),
  KEY `contact_uid2msguid` (`folder_id`,`uid`,`msguid`),
  CONSTRAINT `fk_kolab_cache_contact_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_contact`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_contact` WRITE;
/*!40000 ALTER TABLE `kolab_cache_contact` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_contact` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_dav_contact`
--

DROP TABLE IF EXISTS `kolab_cache_dav_contact`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_dav_contact` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `etag` varchar(128) DEFAULT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  `type` varchar(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `name` varchar(255) NOT NULL,
  `firstname` varchar(255) NOT NULL,
  `surname` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  PRIMARY KEY (`folder_id`,`uid`),
  KEY `contact_type` (`folder_id`,`type`),
  CONSTRAINT `fk_kolab_cache_dav_contact_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_dav_contact`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_dav_contact` WRITE;
/*!40000 ALTER TABLE `kolab_cache_dav_contact` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_dav_contact` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_dav_event`
--

DROP TABLE IF EXISTS `kolab_cache_dav_event`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_dav_event` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `etag` varchar(128) DEFAULT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  `dtstart` datetime DEFAULT NULL,
  `dtend` datetime DEFAULT NULL,
  PRIMARY KEY (`folder_id`,`uid`),
  CONSTRAINT `fk_kolab_cache_dav_event_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_dav_event`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_dav_event` WRITE;
/*!40000 ALTER TABLE `kolab_cache_dav_event` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_dav_event` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_dav_note`
--

DROP TABLE IF EXISTS `kolab_cache_dav_note`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_dav_note` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `etag` varchar(128) DEFAULT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  PRIMARY KEY (`folder_id`,`uid`),
  CONSTRAINT `fk_kolab_cache_dav_note_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_dav_note`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_dav_note` WRITE;
/*!40000 ALTER TABLE `kolab_cache_dav_note` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_dav_note` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_dav_task`
--

DROP TABLE IF EXISTS `kolab_cache_dav_task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_dav_task` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `etag` varchar(128) DEFAULT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  `dtstart` datetime DEFAULT NULL,
  `dtend` datetime DEFAULT NULL,
  PRIMARY KEY (`folder_id`,`uid`),
  CONSTRAINT `fk_kolab_cache_dav_task_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_dav_task`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_dav_task` WRITE;
/*!40000 ALTER TABLE `kolab_cache_dav_task` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_dav_task` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_event`
--

DROP TABLE IF EXISTS `kolab_cache_event`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_event` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `msguid` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  `dtstart` datetime DEFAULT NULL,
  `dtend` datetime DEFAULT NULL,
  PRIMARY KEY (`folder_id`,`msguid`),
  KEY `event_uid2msguid` (`folder_id`,`uid`,`msguid`),
  CONSTRAINT `fk_kolab_cache_event_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_event`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_event` WRITE;
/*!40000 ALTER TABLE `kolab_cache_event` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_event` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_file`
--

DROP TABLE IF EXISTS `kolab_cache_file`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_file` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `msguid` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  `filename` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`folder_id`,`msguid`),
  KEY `folder_filename` (`folder_id`,`filename`),
  KEY `file_uid2msguid` (`folder_id`,`uid`,`msguid`),
  CONSTRAINT `fk_kolab_cache_file_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_file`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_file` WRITE;
/*!40000 ALTER TABLE `kolab_cache_file` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_file` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_freebusy`
--

DROP TABLE IF EXISTS `kolab_cache_freebusy`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_freebusy` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `msguid` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  `dtstart` datetime DEFAULT NULL,
  `dtend` datetime DEFAULT NULL,
  PRIMARY KEY (`folder_id`,`msguid`),
  KEY `freebusy_uid2msguid` (`folder_id`,`uid`,`msguid`),
  CONSTRAINT `fk_kolab_cache_freebusy_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_freebusy`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_freebusy` WRITE;
/*!40000 ALTER TABLE `kolab_cache_freebusy` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_freebusy` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_journal`
--

DROP TABLE IF EXISTS `kolab_cache_journal`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_journal` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `msguid` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  `dtstart` datetime DEFAULT NULL,
  `dtend` datetime DEFAULT NULL,
  PRIMARY KEY (`folder_id`,`msguid`),
  KEY `journal_uid2msguid` (`folder_id`,`uid`,`msguid`),
  CONSTRAINT `fk_kolab_cache_journal_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_journal`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_journal` WRITE;
/*!40000 ALTER TABLE `kolab_cache_journal` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_journal` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_note`
--

DROP TABLE IF EXISTS `kolab_cache_note`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_note` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `msguid` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  PRIMARY KEY (`folder_id`,`msguid`),
  KEY `note_uid2msguid` (`folder_id`,`uid`,`msguid`),
  CONSTRAINT `fk_kolab_cache_note_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_note`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_note` WRITE;
/*!40000 ALTER TABLE `kolab_cache_note` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_note` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_cache_task`
--

DROP TABLE IF EXISTS `kolab_cache_task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_cache_task` (
  `folder_id` bigint(20) unsigned NOT NULL,
  `msguid` bigint(20) unsigned NOT NULL,
  `uid` varchar(512) NOT NULL,
  `created` datetime DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  `data` longtext NOT NULL,
  `tags` text NOT NULL,
  `words` text NOT NULL,
  `dtstart` datetime DEFAULT NULL,
  `dtend` datetime DEFAULT NULL,
  PRIMARY KEY (`folder_id`,`msguid`),
  KEY `task_uid2msguid` (`folder_id`,`uid`,`msguid`),
  CONSTRAINT `fk_kolab_cache_task_folder` FOREIGN KEY (`folder_id`) REFERENCES `kolab_folders` (`folder_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_cache_task`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_cache_task` WRITE;
/*!40000 ALTER TABLE `kolab_cache_task` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_cache_task` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `kolab_folders`
--

DROP TABLE IF EXISTS `kolab_folders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kolab_folders` (
  `folder_id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `resource` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `type` varchar(32) NOT NULL,
  `synclock` int(10) NOT NULL DEFAULT 0,
  `ctag` varchar(128) DEFAULT NULL,
  `changed` datetime DEFAULT NULL,
  PRIMARY KEY (`folder_id`),
  KEY `resource_type` (`resource`,`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `kolab_folders`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `kolab_folders` WRITE;
/*!40000 ALTER TABLE `kolab_folders` DISABLE KEYS */;
/*!40000 ALTER TABLE `kolab_folders` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `responses`
--

DROP TABLE IF EXISTS `responses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `responses` (
  `response_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `name` varchar(255) NOT NULL,
  `data` longtext NOT NULL,
  `is_html` tinyint(1) NOT NULL DEFAULT 0,
  `changed` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  `del` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`response_id`),
  KEY `user_responses_index` (`user_id`,`del`),
  CONSTRAINT `user_id_fk_responses` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `responses`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `responses` WRITE;
/*!40000 ALTER TABLE `responses` DISABLE KEYS */;
/*!40000 ALTER TABLE `responses` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `searches`
--

DROP TABLE IF EXISTS `searches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `searches` (
  `search_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `type` int(3) NOT NULL DEFAULT 0,
  `name` varchar(128) NOT NULL,
  `data` text DEFAULT NULL,
  PRIMARY KEY (`search_id`),
  UNIQUE KEY `uniqueness` (`user_id`,`type`,`name`),
  CONSTRAINT `user_id_fk_searches` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `searches`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `searches` WRITE;
/*!40000 ALTER TABLE `searches` DISABLE KEYS */;
/*!40000 ALTER TABLE `searches` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `session`
--

DROP TABLE IF EXISTS `session`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `session` (
  `sess_id` varchar(128) NOT NULL,
  `changed` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  `ip` varchar(40) NOT NULL,
  `vars` mediumtext NOT NULL,
  PRIMARY KEY (`sess_id`),
  KEY `changed_index` (`changed`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `session`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `session` WRITE;
/*!40000 ALTER TABLE `session` DISABLE KEYS */;
INSERT INTO `session` VALUES
('47cdc0e2c845281703f6c746fa71a61e','2026-03-21 16:28:52','209.133.32.5','dGVtcHxiOjE7bGFuZ3VhZ2V8czo1OiJlbl9VUyI7dGFza3xzOjU6ImxvZ2luIjtza2luX2NvbmZpZ3xhOjc6e3M6MTc6InN1cHBvcnRlZF9sYXlvdXRzIjthOjE6e2k6MDtzOjEwOiJ3aWRlc2NyZWVuIjt9czoyMjoianF1ZXJ5X3VpX2NvbG9yc190aGVtZSI7czo5OiJib290c3RyYXAiO3M6MTg6ImVtYmVkX2Nzc19sb2NhdGlvbiI7czoxNzoiL3N0eWxlcy9lbWJlZC5jc3MiO3M6MTk6ImVkaXRvcl9jc3NfbG9jYXRpb24iO3M6MTc6Ii9zdHlsZXMvZW1iZWQuY3NzIjtzOjE3OiJkYXJrX21vZGVfc3VwcG9ydCI7YjoxO3M6MjY6Im1lZGlhX2Jyb3dzZXJfY3NzX2xvY2F0aW9uIjtzOjQ6Im5vbmUiO3M6MjE6ImFkZGl0aW9uYWxfbG9nb190eXBlcyI7YTozOntpOjA7czo0OiJkYXJrIjtpOjE7czo1OiJzbWFsbCI7aToyO3M6MTA6InNtYWxsLWRhcmsiO319cmVxdWVzdF90b2tlbnxzOjMyOiJKTGRiNU1QMVpyaEl2a1NnWkpHQUJ6a3JSalBZa3N4TyI7'),
('5jbu1k33l46d8u74jibkn072hq','2026-03-08 13:40:07','72.201.61.64','bGFuZ3VhZ2V8czo1OiJlbl9VUyI7aW1hcF9uYW1lc3BhY2V8YTo0OntzOjg6InBlcnNvbmFsIjthOjE6e2k6MDthOjI6e2k6MDtzOjA6IiI7aToxO3M6MToiLiI7fX1zOjU6Im90aGVyIjtOO3M6Njoic2hhcmVkIjtOO3M6MTA6InByZWZpeF9vdXQiO3M6MDoiIjt9aW1hcF9kZWxpbWl0ZXJ8czoxOiIuIjtpbWFwX2xpc3RfY29uZnxhOjI6e2k6MDtOO2k6MTthOjA6e319dXNlcl9pZHxpOjE7dXNlcm5hbWV8czoxNjoidGhhbmdAaG91c2V2by51cyI7c3RvcmFnZV9ob3N0fHM6OToibG9jYWxob3N0IjtzdG9yYWdlX3BvcnR8aToxNDM7c3RvcmFnZV9zc2x8YjowO3Bhc3N3b3JkfHM6MzI6IkJ6S1ZtRDdZWWJ5VFJZbzErb2p0ZkpYUWNhN1l1MWlnIjtsb2dpbl90aW1lfGk6MTc3MzAwMTkwMDt0aW1lem9uZXxzOjEyOiJBc2lhL0JhZ2hkYWQiO1NUT1JBR0VfU1BFQ0lBTC1VU0V8YjoxO2F1dGhfc2VjcmV0fHM6MjY6IklRa3pBZnNLMVQ0czJGVFI3U2NrZzlGSm12IjtyZXF1ZXN0X3Rva2VufHM6MzI6InVSamdua2pNQ0R5ek1ORHl4Qml5c28yVnJrMFh3VlBwIjt0YXNrfHM6NToibG9naW4iO3NraW5fY29uZmlnfGE6Nzp7czoxNzoic3VwcG9ydGVkX2xheW91dHMiO2E6MTp7aTowO3M6MTA6IndpZGVzY3JlZW4iO31zOjIyOiJqcXVlcnlfdWlfY29sb3JzX3RoZW1lIjtzOjk6ImJvb3RzdHJhcCI7czoxODoiZW1iZWRfY3NzX2xvY2F0aW9uIjtzOjE3OiIvc3R5bGVzL2VtYmVkLmNzcyI7czoxOToiZWRpdG9yX2Nzc19sb2NhdGlvbiI7czoxNzoiL3N0eWxlcy9lbWJlZC5jc3MiO3M6MTc6ImRhcmtfbW9kZV9zdXBwb3J0IjtiOjE7czoyNjoibWVkaWFfYnJvd3Nlcl9jc3NfbG9jYXRpb24iO3M6NDoibm9uZSI7czoyMToiYWRkaXRpb25hbF9sb2dvX3R5cGVzIjthOjM6e2k6MDtzOjQ6ImRhcmsiO2k6MTtzOjU6InNtYWxsIjtpOjI7czoxMDoic21hbGwtZGFyayI7fX1pbWFwX2hvc3R8czo5OiJsb2NhbGhvc3QiO21ib3h8czo1OiJJTkJPWCI7c29ydF9jb2x8czo3OiJhcnJpdmFsIjtzb3J0X29yZGVyfHM6NDoiREVTQyI7U1RPUkFHRV9USFJFQUR8YTozOntpOjA7czoxMDoiUkVGRVJFTkNFUyI7aToxO3M6NDoiUkVGUyI7aToyO3M6MTQ6Ik9SREVSRURTVUJKRUNUIjt9U1RPUkFHRV9RVU9UQXxiOjA7U1RPUkFHRV9MSVNULUVYVEVOREVEfGI6MTtsaXN0X2F0dHJpYnxhOjY6e3M6NDoibmFtZSI7czo4OiJtZXNzYWdlcyI7czoyOiJpZCI7czoxMToibWVzc2FnZWxpc3QiO3M6NToiY2xhc3MiO3M6NDI6Imxpc3RpbmcgbWVzc2FnZWxpc3Qgc29ydGhlYWRlciBmaXhlZGhlYWRlciI7czoxNToiYXJpYS1sYWJlbGxlZGJ5IjtzOjIyOiJhcmlhLWxhYmVsLW1lc3NhZ2VsaXN0IjtzOjk6ImRhdGEtbGlzdCI7czoxMjoibWVzc2FnZV9saXN0IjtzOjE0OiJkYXRhLWxhYmVsLW1zZyI7czoxODoiVGhlIGxpc3QgaXMgZW1wdHkuIjt9Zm9sZGVyc3xhOjI4OntzOjU6IklOQk9YIjthOjI6e3M6MzoiY250IjtpOjU2ODI7czo2OiJtYXh1aWQiO2k6NTc1OTt9czo5OiJJTkJPWC5BRHMiO2E6Mjp7czozOiJjbnQiO2k6MTUyNzM7czo2OiJtYXh1aWQiO2k6MTYwNDA7fXM6MTE6IklOQk9YLkJpbGxzIjthOjI6e3M6MzoiY250IjtpOjc2MTtzOjY6Im1heHVpZCI7aTo3NjE7fXM6MTQ6IklOQk9YLkJ1c2luZXNzIjthOjI6e3M6MzoiY250IjtpOjgxO3M6NjoibWF4dWlkIjtpOjgxO31zOjI4OiJJTkJPWC5CdXNpbmVzcy5IViBDb25zdWx0aW5nIjthOjI6e3M6MzoiY250IjtpOjE3MjQ7czo2OiJtYXh1aWQiO2k6MTcyNDt9czoyNjoiSU5CT1guQnVzaW5lc3MuVm8gSG9sZGluZ3MiO2E6Mjp7czozOiJjbnQiO2k6MDtzOjY6Im1heHVpZCI7aTowO31zOjIwOiJJTkJPWC5DcmVkaXQgTm90aWNlcyI7YToyOntzOjM6ImNudCI7aTo2NDI7czo2OiJtYXh1aWQiO2k6NjQyO31zOjEyOiJJTkJPWC5DcnlwdG8iO2E6Mjp7czozOiJjbnQiO2k6OTk2O3M6NjoibWF4dWlkIjtpOjk5Njt9czoxMToiSU5CT1guRE1BUkMiO2E6Mjp7czozOiJjbnQiO2k6MTg3O3M6NjoibWF4dWlkIjtpOjE4Nzt9czoxNToiSU5CT1guRGVsaXZlcmVkIjthOjI6e3M6MzoiY250IjtpOjY3NztzOjY6Im1heHVpZCI7aTo2Nzc7fXM6MTM6IklOQk9YLkZpbmFuY2UiO2E6Mjp7czozOiJjbnQiO2k6NzA0MDtzOjY6Im1heHVpZCI7aTo3MDQwO31zOjk6IklOQk9YLkdDVSI7YToyOntzOjM6ImNudCI7aTo5MjtzOjY6Im1heHVpZCI7aTo5Mjt9czoxODoiSU5CT1guSm9iIExpc3RpbmdzIjthOjI6e3M6MzoiY250IjtpOjQxMTE7czo2OiJtYXh1aWQiO2k6NDExMTt9czoyNjoiSU5CT1guSm9iIExpc3RpbmdzLlJlamVjdHMiO2E6Mjp7czozOiJjbnQiO2k6Mjc7czo2OiJtYXh1aWQiO2k6Mjc7fXM6MTc6IklOQk9YLktpZHMgU2Nob29sIjthOjI6e3M6MzoiY250IjtpOjE3NjtzOjY6Im1heHVpZCI7aToxNzY7fXM6MTM6IklOQk9YLkxvdHRlcnkiO2E6Mjp7czozOiJjbnQiO2k6MjU0MztzOjY6Im1heHVpZCI7aToyNTQzO31zOjE0OiJJTkJPWC5NaWxpdGFyeSI7YToyOntzOjM6ImNudCI7aToxMjc3O3M6NjoibWF4dWlkIjtpOjEyNzc7fXM6MTc6IklOQk9YLk5ld3NsZXR0ZXJzIjthOjI6e3M6MzoiY250IjtpOjMxMzM7czo2OiJtYXh1aWQiO2k6MzEzMzt9czoxNDoiSU5CT1guUmVjZWlwdHMiO2E6Mjp7czozOiJjbnQiO2k6MjA1NjtzOjY6Im1heHVpZCI7aToyMDU2O31zOjEzOiJJTkJPWC5TaGlwcGVkIjthOjI6e3M6MzoiY250IjtpOjYxNjtzOjY6Im1heHVpZCI7aTo2MTY7fXM6OToiSU5CT1guVGF4IjthOjI6e3M6MzoiY250IjtpOjI7czo2OiJtYXh1aWQiO2k6Mjt9czoxMjoiSU5CT1guVHJhZGVzIjthOjI6e3M6MzoiY250IjtpOjIyNztzOjY6Im1heHVpZCI7aToyMjc7fXM6MjA6IklOQk9YLlVTUFMtRkVERVgtVVBTIjthOjI6e3M6MzoiY250IjtpOjI5MDc7czo2OiJtYXh1aWQiO2k6MjkwNzt9czo2OiJEcmFmdHMiO2E6Mjp7czozOiJjbnQiO2k6MDtzOjY6Im1heHVpZCI7aTowO31zOjQ6IlNlbnQiO2E6Mjp7czozOiJjbnQiO2k6NTtzOjY6Im1heHVpZCI7aTo1O31zOjU6IlRyYXNoIjthOjI6e3M6MzoiY250IjtpOjM7czo2OiJtYXh1aWQiO2k6Mzt9czoxNjoiRGVsZXRlZCBNZXNzYWdlcyI7YToyOntzOjM6ImNudCI7aToyO3M6NjoibWF4dWlkIjtpOjc3MTt9czo1OiJOb3RlcyI7YToyOntzOjM6ImNudCI7aTowO3M6NjoibWF4dWlkIjtpOjA7fX1TVE9SQUdFX1NPUlR8YjoxO3Vuc2Vlbl9jb3VudHxhOjI4OntzOjU6IklOQk9YIjtpOjU7czo5OiJJTkJPWC5BRHMiO2k6MTA0NzM7czoxMToiSU5CT1guQmlsbHMiO2k6MDtzOjE0OiJJTkJPWC5CdXNpbmVzcyI7aTowO3M6Mjg6IklOQk9YLkJ1c2luZXNzLkhWIENvbnN1bHRpbmciO2k6MDtzOjI2OiJJTkJPWC5CdXNpbmVzcy5WbyBIb2xkaW5ncyI7aTowO3M6MjA6IklOQk9YLkNyZWRpdCBOb3RpY2VzIjtpOjA7czoxMjoiSU5CT1guQ3J5cHRvIjtpOjA7czoxMToiSU5CT1guRE1BUkMiO2k6MTI3O3M6MTU6IklOQk9YLkRlbGl2ZXJlZCI7aTowO3M6MTM6IklOQk9YLkZpbmFuY2UiO2k6MDtzOjk6IklOQk9YLkdDVSI7aTowO3M6MTg6IklOQk9YLkpvYiBMaXN0aW5ncyI7aToxOTM1O3M6MjY6IklOQk9YLkpvYiBMaXN0aW5ncy5SZWplY3RzIjtpOjA7czoxNzoiSU5CT1guS2lkcyBTY2hvb2wiO2k6MDtzOjEzOiJJTkJPWC5Mb3R0ZXJ5IjtpOjA7czoxNDoiSU5CT1guTWlsaXRhcnkiO2k6MDtzOjE3OiJJTkJPWC5OZXdzbGV0dGVycyI7aToxMjg5O3M6MTQ6IklOQk9YLlJlY2VpcHRzIjtpOjA7czoxMzoiSU5CT1guU2hpcHBlZCI7aTowO3M6OToiSU5CT1guVGF4IjtpOjA7czoxMjoiSU5CT1guVHJhZGVzIjtpOjA7czoyMDoiSU5CT1guVVNQUy1GRURFWC1VUFMiO2k6MDtzOjY6IkRyYWZ0cyI7aTowO3M6NDoiU2VudCI7aTowO3M6NToiVHJhc2giO2k6MDtzOjE2OiJEZWxldGVkIE1lc3NhZ2VzIjtpOjA7czo1OiJOb3RlcyI7aTowO31saXN0X21vZF9zZXF8czo0OiI2MTkyIjt0ZW1wfGI6MTs='),
('5st5i0staevrsm0oi493f2j2q4','2026-03-13 09:32:27','72.201.61.64','dGVtcHxiOjE7bGFuZ3VhZ2V8czo1OiJlbl9VUyI7dGFza3xzOjU6ImxvZ2luIjtza2luX2NvbmZpZ3xhOjc6e3M6MTc6InN1cHBvcnRlZF9sYXlvdXRzIjthOjE6e2k6MDtzOjEwOiJ3aWRlc2NyZWVuIjt9czoyMjoianF1ZXJ5X3VpX2NvbG9yc190aGVtZSI7czo5OiJib290c3RyYXAiO3M6MTg6ImVtYmVkX2Nzc19sb2NhdGlvbiI7czoxNzoiL3N0eWxlcy9lbWJlZC5jc3MiO3M6MTk6ImVkaXRvcl9jc3NfbG9jYXRpb24iO3M6MTc6Ii9zdHlsZXMvZW1iZWQuY3NzIjtzOjE3OiJkYXJrX21vZGVfc3VwcG9ydCI7YjoxO3M6MjY6Im1lZGlhX2Jyb3dzZXJfY3NzX2xvY2F0aW9uIjtzOjQ6Im5vbmUiO3M6MjE6ImFkZGl0aW9uYWxfbG9nb190eXBlcyI7YTozOntpOjA7czo0OiJkYXJrIjtpOjE7czo1OiJzbWFsbCI7aToyO3M6MTA6InNtYWxsLWRhcmsiO319cmVxdWVzdF90b2tlbnxzOjMyOiJTaWQ0VzdkS3FHRWVadlJBMVFLMDcxMHZrRDZHZ0JVNCI7'),
('r7r5edsbafmms03nrs3sdfmgoh','2026-03-08 06:49:06','127.0.0.1','dGVtcHxiOjE7bGFuZ3VhZ2V8czo1OiJlbl9VUyI7dGFza3xzOjU6ImxvZ2luIjtza2luX2NvbmZpZ3xhOjc6e3M6MTc6InN1cHBvcnRlZF9sYXlvdXRzIjthOjE6e2k6MDtzOjEwOiJ3aWRlc2NyZWVuIjt9czoyMjoianF1ZXJ5X3VpX2NvbG9yc190aGVtZSI7czo5OiJib290c3RyYXAiO3M6MTg6ImVtYmVkX2Nzc19sb2NhdGlvbiI7czoxNzoiL3N0eWxlcy9lbWJlZC5jc3MiO3M6MTk6ImVkaXRvcl9jc3NfbG9jYXRpb24iO3M6MTc6Ii9zdHlsZXMvZW1iZWQuY3NzIjtzOjE3OiJkYXJrX21vZGVfc3VwcG9ydCI7YjoxO3M6MjY6Im1lZGlhX2Jyb3dzZXJfY3NzX2xvY2F0aW9uIjtzOjQ6Im5vbmUiO3M6MjE6ImFkZGl0aW9uYWxfbG9nb190eXBlcyI7YTozOntpOjA7czo0OiJkYXJrIjtpOjE7czo1OiJzbWFsbCI7aToyO3M6MTA6InNtYWxsLWRhcmsiO319cmVxdWVzdF90b2tlbnxzOjMyOiJmYnRkWkZWWjczdE15WWdsRENPNE5lak5lckttTW1qayI7'),
('v01itqmac4gtils7o0p50n2847','2026-03-08 15:30:30','72.201.61.64','bGFuZ3VhZ2V8czo1OiJlbl9VUyI7aW1hcF9uYW1lc3BhY2V8YTo0OntzOjg6InBlcnNvbmFsIjthOjE6e2k6MDthOjI6e2k6MDtzOjA6IiI7aToxO3M6MToiLiI7fX1zOjU6Im90aGVyIjtOO3M6Njoic2hhcmVkIjtOO3M6MTA6InByZWZpeF9vdXQiO3M6MDoiIjt9aW1hcF9kZWxpbWl0ZXJ8czoxOiIuIjtpbWFwX2xpc3RfY29uZnxhOjI6e2k6MDtOO2k6MTthOjA6e319dXNlcl9pZHxpOjE7dXNlcm5hbWV8czoxNjoidGhhbmdAaG91c2V2by51cyI7c3RvcmFnZV9ob3N0fHM6OToibG9jYWxob3N0IjtzdG9yYWdlX3BvcnR8aToxNDM7c3RvcmFnZV9zc2x8YjowO3Bhc3N3b3JkfHM6MzI6ImIvdDJ6TlpPRGMxSWREeW5yenJISXNMQXVRcDYxTDZpIjtsb2dpbl90aW1lfGk6MTc3MzAwNTc5ODt0aW1lem9uZXxzOjEyOiJBc2lhL0JhZ2hkYWQiO1NUT1JBR0VfU1BFQ0lBTC1VU0V8YjoxO2F1dGhfc2VjcmV0fHM6MjY6InQ3UHg1ZlZBakRXandFVjRGQTJ5YzA3dGhKIjtyZXF1ZXN0X3Rva2VufHM6MzI6InVNQnk5azgxblVzV3l6OElZWG45elo2TjdYV05SVlVSIjt0YXNrfHM6ODoic2V0dGluZ3MiO3NraW5fY29uZmlnfGE6Nzp7czoxNzoic3VwcG9ydGVkX2xheW91dHMiO2E6MTp7aTowO3M6MTA6IndpZGVzY3JlZW4iO31zOjIyOiJqcXVlcnlfdWlfY29sb3JzX3RoZW1lIjtzOjk6ImJvb3RzdHJhcCI7czoxODoiZW1iZWRfY3NzX2xvY2F0aW9uIjtzOjE3OiIvc3R5bGVzL2VtYmVkLmNzcyI7czoxOToiZWRpdG9yX2Nzc19sb2NhdGlvbiI7czoxNzoiL3N0eWxlcy9lbWJlZC5jc3MiO3M6MTc6ImRhcmtfbW9kZV9zdXBwb3J0IjtiOjE7czoyNjoibWVkaWFfYnJvd3Nlcl9jc3NfbG9jYXRpb24iO3M6NDoibm9uZSI7czoyMToiYWRkaXRpb25hbF9sb2dvX3R5cGVzIjthOjM6e2k6MDtzOjQ6ImRhcmsiO2k6MTtzOjU6InNtYWxsIjtpOjI7czoxMDoic21hbGwtZGFyayI7fX1pbWFwX2hvc3R8czo5OiJsb2NhbGhvc3QiO21ib3h8czo1OiJJTkJPWCI7c29ydF9jb2x8czo3OiJhcnJpdmFsIjtzb3J0X29yZGVyfHM6NDoiREVTQyI7U1RPUkFHRV9USFJFQUR8YTozOntpOjA7czoxMDoiUkVGRVJFTkNFUyI7aToxO3M6NDoiUkVGUyI7aToyO3M6MTQ6Ik9SREVSRURTVUJKRUNUIjt9U1RPUkFHRV9RVU9UQXxiOjA7U1RPUkFHRV9MSVNULUVYVEVOREVEfGI6MTtsaXN0X2F0dHJpYnxhOjc6e3M6NDoibmFtZSI7czo4OiJtZXNzYWdlcyI7czoyOiJpZCI7czoxMToibWVzc2FnZWxpc3QiO3M6NToiY2xhc3MiO3M6NDI6Imxpc3RpbmcgbWVzc2FnZWxpc3Qgc29ydGhlYWRlciBmaXhlZGhlYWRlciI7czoxNToiYXJpYS1sYWJlbGxlZGJ5IjtzOjIyOiJhcmlhLWxhYmVsLW1lc3NhZ2VsaXN0IjtzOjk6ImRhdGEtbGlzdCI7czoxMjoibWVzc2FnZV9saXN0IjtzOjE0OiJkYXRhLWxhYmVsLW1zZyI7czoxODoiVGhlIGxpc3QgaXMgZW1wdHkuIjtzOjc6ImNvbHVtbnMiO2E6ODp7aTowO3M6NzoidGhyZWFkcyI7aToxO3M6Nzoic3ViamVjdCI7aToyO3M6Njoic3RhdHVzIjtpOjM7czo2OiJmcm9tdG8iO2k6NDtzOjQ6ImRhdGUiO2k6NTtzOjQ6InNpemUiO2k6NjtzOjQ6ImZsYWciO2k6NztzOjEwOiJhdHRhY2htZW50Ijt9fXVuc2Vlbl9jb3VudHxhOjE6e3M6NToiSU5CT1giO2k6NDt9Zm9sZGVyc3xhOjE6e3M6NToiSU5CT1giO2E6Mjp7czozOiJjbnQiO2k6NTY4MjtzOjY6Im1heHVpZCI7aTo1NzU5O319U1RPUkFHRV9TT1JUfGI6MTtsaXN0X21vZF9zZXF8czo0OiI2MTkzIjttYW5hZ2VzaWV2ZV9jdXJyZW50fHM6OToicm91bmRjdWJlIjttYW5hZ2VzaWV2ZS1jb21wYWN0LWZvcm18YjoxOw==');
/*!40000 ALTER TABLE `session` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `system`
--

DROP TABLE IF EXISTS `system`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `system` (
  `name` varchar(64) NOT NULL,
  `value` mediumtext DEFAULT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `system`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `system` WRITE;
/*!40000 ALTER TABLE `system` DISABLE KEYS */;
INSERT INTO `system` VALUES
('calendar-database-version','2021102600'),
('libkolab-version','2026013000'),
('roundcube-version','2022081200');
/*!40000 ALTER TABLE `system` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `mail_host` varchar(128) NOT NULL,
  `created` datetime NOT NULL DEFAULT '1000-01-01 00:00:00',
  `last_login` datetime DEFAULT NULL,
  `failed_login` datetime DEFAULT NULL,
  `failed_login_counter` int(10) unsigned DEFAULT NULL,
  `language` varchar(16) DEFAULT NULL,
  `preferences` longtext DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `username` (`username`,`mail_host`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES
(1,'thang@housevo.us','localhost','2026-03-06 18:25:06','2026-03-08 14:36:38','2026-03-07 21:59:18',1,'en_US','a:27:{s:14:\"compose_extwin\";i:0;s:10:\"htmleditor\";i:4;s:11:\"mdn_default\";b:0;s:11:\"dsn_default\";b:0;s:18:\"strip_existing_sig\";b:0;s:12:\"default_font\";s:15:\"Times New Roman\";s:17:\"default_font_size\";s:4:\"12pt\";s:25:\"compose_save_localstorage\";i:1;s:19:\"attachment_reminder\";b:1;s:19:\"default_addressbook\";s:1:\"0\";s:20:\"collected_recipients\";s:1:\"1\";s:17:\"collected_senders\";s:1:\"2\";s:20:\"addressbook_pagesize\";i:100;s:17:\"check_all_folders\";b:1;s:13:\"mail_pagesize\";i:100;s:22:\"newmail_notifier_basic\";b:0;s:24:\"newmail_notifier_desktop\";b:0;s:22:\"newmail_notifier_sound\";b:1;s:32:\"newmail_notifier_desktop_timeout\";i:5;s:16:\"message_sort_col\";s:7:\"arrival\";s:17:\"message_threading\";a:23:{s:9:\"INBOX.ADs\";b:0;s:11:\"INBOX.Bills\";b:0;s:20:\"INBOX.Credit Notices\";b:0;s:14:\"INBOX.Business\";b:0;s:28:\"INBOX.Business.HV Consulting\";b:0;s:26:\"INBOX.Business.Vo Holdings\";b:0;s:12:\"INBOX.Crypto\";b:0;s:15:\"INBOX.Delivered\";b:0;s:11:\"INBOX.DMARC\";b:0;s:13:\"INBOX.Finance\";b:0;s:9:\"INBOX.GCU\";b:0;s:18:\"INBOX.Job Listings\";b:0;s:26:\"INBOX.Job Listings.Rejects\";b:0;s:17:\"INBOX.Kids School\";b:0;s:13:\"INBOX.Lottery\";b:0;s:14:\"INBOX.Military\";b:0;s:17:\"INBOX.Newsletters\";b:0;s:14:\"INBOX.Receipts\";b:0;s:13:\"INBOX.Shipped\";b:0;s:9:\"INBOX.Tax\";b:0;s:12:\"INBOX.Trades\";b:0;s:20:\"INBOX.USPS-FEDEX-UPS\";b:0;s:5:\"INBOX\";b:1;}s:14:\"message_extwin\";i:0;s:18:\"message_show_email\";b:1;s:11:\"show_images\";i:2;s:15:\"default_charset\";s:5:\"UTF-8\";s:17:\"collapsed_folders\";s:0:\"\";s:11:\"client_hash\";s:16:\"QjtIMjgf0ZVDRD4A\";}'),
(2,'melissa@housevo.us','localhost','2026-03-07 00:23:05','2026-03-07 01:36:51',NULL,NULL,'en_US','a:1:{s:11:\"client_hash\";s:16:\"tP4xj5MQMmxwnneh\";}'),
(3,'_global_addressbook_user_','localhost','2026-03-07 01:36:51',NULL,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping events for database 'roundcube'
--

--
-- Dumping routines for database 'roundcube'
--

--
-- Current Database: `postfixadmin`
--

USE `postfixadmin`;

--
-- Final view structure for view `sogo_view`
--

/*!50001 DROP VIEW IF EXISTS `sogo_view`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb3 */;
/*!50001 SET character_set_results     = utf8mb3 */;
/*!50001 SET collation_connection      = utf8mb3_general_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `sogo_view` AS select `mailbox`.`username` AS `c_uid`,`mailbox`.`username` AS `c_name`,`mailbox`.`password` AS `c_password`,`mailbox`.`name` AS `c_cn`,`mailbox`.`username` AS `mail` from `mailbox` where `mailbox`.`active` = 1 */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Current Database: `vmail`
--

USE `vmail`;

--
-- Current Database: `roundcube`
--

USE `roundcube`;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

-- Dump completed on 2026-06-21  3:34:19
