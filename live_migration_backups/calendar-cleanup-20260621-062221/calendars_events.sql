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
) ENGINE=InnoDB AUTO_INCREMENT=176 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
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
(148,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:18:57'),
(149,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:36:10'),
(150,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:36:11'),
(151,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:36:12'),
(152,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:54:38'),
(153,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:54:38'),
(154,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 10:54:39'),
(155,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 11:12:17'),
(156,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 11:12:18'),
(157,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 11:12:19'),
(158,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 11:30:35'),
(159,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 11:30:35'),
(160,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 11:30:36'),
(161,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 11:48:11'),
(162,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 11:48:13'),
(163,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 11:48:13'),
(164,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 12:07:03'),
(165,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 12:07:04'),
(166,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 12:07:05'),
(167,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 12:24:11'),
(168,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 12:24:12'),
(169,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 12:24:12'),
(170,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 12:42:41'),
(171,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 12:42:42'),
(172,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 12:42:43'),
(173,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 13:00:41'),
(174,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 13:00:42'),
(175,'thang@housevo.us','Personal','#3498db',1,'2026-06-21 13:00:42');
/*!40000 ALTER TABLE `calendars` ENABLE KEYS */;
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
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

-- Dump completed on 2026-06-21  6:22:21
